// 3D chunking visualiser. Draws the real chunks of the current document as a column of slabs on a
// shared document axis (see lib/chunkGeometry.ts), and animates it from `progressRef` (0..1):
//   0.00-0.06  the document, with its noise (headers, footers, duplicates) in grey
//   0.06-0.55  Traditional: a blade sweeps down; every cut lights up, and blocks it passes through crack
//   0.10-0.40  SmartChunk: noise is thrown out of the column
//   0.50-0.85  SmartChunk: whole blocks separate into chunks, grouped by section (green frames)
//   0.60-0.88  Traditional: the column separates at every cut into its fixed-size chunks
// The page owns the timeline; this component only reads progressRef every frame.

import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ElementRef, MutableRefObject } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { VizModel } from '@/lib/chunkGeometry'
import { token, typeToken } from '@/lib/palette'
import type { ChunkType, Method } from '@/types/api'

export type VizView = 'both' | 'naive' | 'smart'

export interface VizHover {
  method: Method
  block: number | null
  naiveIndex: number | null
  noise: number | null
  clientX: number
  clientY: number
}

interface ChunkVisualizerSceneProps {
  model: VizModel
  progressRef: MutableRefObject<number>
  view: VizView
  reduced: boolean
  selectedBlock: number | null
  onHover: (hover: VizHover | null) => void
  onSelect: (block: number | null) => void
}

type OrbitControlsImpl = ElementRef<typeof OrbitControls>

const COLUMN_W = 4.3
const DEPTH = 0.32
const GAP_NAIVE = 0.34
const GAP_SMART = 0.1
const GAP_SECTION = 0.5
const SIDE_X = 3.5

const WIDTH: Record<ChunkType, number> = { prose: 4.0, code: 3.5, table: 4.3, list: 3.2 }

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

interface Layout {
  height: number
  scale: number
  noiseH: number
  /** Distance from the column top to each block's top, with noise slabs in place. */
  blockTop: number[]
  /** Same, with the noise removed (SmartChunk after cleaning). */
  blockTopClean: number[]
  noiseTop: number[]
  /** Traditional chunk that each noise slab ends up inside. */
  noiseNaive: number[]
  finalNaiveHeight: number
  finalSmartHeight: number
}

function buildLayout(model: VizModel): Layout {
  const blockCount = model.blocks.length
  const height = Math.min(44, Math.max(8, blockCount * 0.5))
  const noiseH = model.noise.length > 0 ? Math.min(0.14, (height * 0.2) / model.noise.length) : 0
  const scale = (height - model.noise.length * noiseH) / Math.max(1, model.total)
  const order = model.noise
    .map((noise, index) => ({ noise, index }))
    .sort((a, b) => a.noise.afterBlock - b.noise.afterBlock)
  const blockTop: number[] = new Array<number>(blockCount).fill(0)
  const blockTopClean: number[] = new Array<number>(blockCount).fill(0)
  const noiseTop: number[] = new Array<number>(model.noise.length).fill(0)
  const noiseNaive: number[] = new Array<number>(model.noise.length).fill(0)
  let cursor = 0
  let noisePointer = 0
  const placeNoiseAfter = (afterBlock: number, naiveIndex: number) => {
    while (
      noisePointer < order.length &&
      (order[noisePointer]?.noise.afterBlock ?? Infinity) <= afterBlock
    ) {
      const entry = order[noisePointer]
      if (entry) {
        noiseTop[entry.index] = cursor
        noiseNaive[entry.index] = naiveIndex
      }
      cursor += noiseH
      noisePointer += 1
    }
  }
  placeNoiseAfter(-1, 0)
  model.blocks.forEach((block, index) => {
    blockTop[index] = cursor
    blockTopClean[index] = block.start * scale
    cursor += (block.end - block.start) * scale
    const lastSegment = [...model.segments].reverse().find((segment) => segment.block === index)
    placeNoiseAfter(index, lastSegment?.naiveIndex ?? 0)
  })
  placeNoiseAfter(Infinity, model.naive.length - 1)
  const lastNaive = Math.max(0, model.naive.length - 1)
  return {
    height,
    scale,
    noiseH,
    blockTop,
    blockTopClean,
    noiseTop,
    noiseNaive,
    finalNaiveHeight: height + lastNaive * GAP_NAIVE,
    finalSmartHeight:
      model.total * scale +
      Math.max(0, blockCount - 1) * GAP_SMART +
      Math.max(0, model.sections.length - 1) * GAP_SECTION,
  }
}

export function ChunkVisualizerScene({
  model,
  progressRef,
  view,
  reduced,
  selectedBlock,
  onHover,
  onSelect,
}: ChunkVisualizerSceneProps) {
  const naiveMeshRef = useRef<THREE.InstancedMesh>(null)
  const smartMeshRef = useRef<THREE.InstancedMesh>(null)
  const cutMeshRef = useRef<THREE.InstancedMesh>(null)
  const bladeRef = useRef<THREE.Group>(null)
  const frameRefs = useRef<(THREE.LineSegments | null)[]>([])
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const columnX = useRef({ naive: -SIDE_X, smart: SIDE_X, naiveScale: 1, smartScale: 1 })
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  const layout = useMemo(() => buildLayout(model), [model])
  const segmentCount = model.segments.length
  const naiveCount = segmentCount + model.noise.length
  const smartCount = model.blocks.length + model.noise.length
  const cutCount = Math.max(1, model.cuts.length)

  const colors = useMemo(
    () => ({
      types: {
        prose: new THREE.Color(token(typeToken('prose'))),
        code: new THREE.Color(token(typeToken('code'))),
        table: new THREE.Color(token(typeToken('table'))),
        list: new THREE.Color(token(typeToken('list'))),
      },
      bad: new THREE.Color(token('bad')),
      good: new THREE.Color(token('good')),
      noise: new THREE.Color(token('noise')),
      fg: new THREE.Color(token('fg')),
      muted: new THREE.Color(token('muted')),
      bg: new THREE.Color(token('bg')),
      accent: new THREE.Color(token('accent')),
    }),
    [],
  )

  const resources = useMemo(() => {
    const slab = new RoundedBoxGeometry(1, 1, 1, 2, 0.05)
    const slabMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.08 })
    const smartMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.08 })
    const bar = new THREE.BoxGeometry(1, 1, 1)
    const cutMaterial = new THREE.MeshBasicMaterial({ toneMapped: false })
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const frameMaterial = new THREE.LineBasicMaterial({
      color: colors.good,
      transparent: true,
      opacity: 0,
    })
    return { slab, slabMaterial, smartMaterial, bar, cutMaterial, edges, frameMaterial }
  }, [colors])

  useEffect(
    () => () => {
      Object.values(resources).forEach((resource) => resource.dispose())
    },
    [resources],
  )

  // instanceColor must exist before the first render.
  useLayoutEffect(() => {
    for (const mesh of [naiveMeshRef.current, smartMeshRef.current, cutMeshRef.current]) {
      if (!mesh) continue
      for (let i = 0; i < mesh.count; i += 1) mesh.setColorAt(i, colors.fg)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [colors, model])

  // Fit the camera to the final (fully separated) layout whenever the document or view changes.
  const centerY = layout.height / 2 - Math.max(layout.finalNaiveHeight, layout.finalSmartHeight) / 2
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera
    const halfFov = THREE.MathUtils.degToRad(perspective.fov / 2)
    const tallest = Math.max(layout.finalNaiveHeight, layout.finalSmartHeight)
    const width = view === 'both' ? SIDE_X * 2 + COLUMN_W + 1.2 : COLUMN_W + 2
    const aspect = size.width / Math.max(1, size.height)
    const byHeight = (tallest / 2 + 1.6) / Math.tan(halfFov)
    const byWidth = width / 2 / (Math.tan(halfFov) * aspect)
    const distance = Math.max(8, byHeight, byWidth)
    perspective.position.set(distance * 0.18, centerY + 0.5 + distance * 0.06, distance)
    perspective.near = 0.1
    perspective.far = distance * 6
    perspective.updateProjectionMatrix()
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(0, centerY + 0.5, 0)
      controls.maxDistance = distance * 2.5
      controls.update()
    }
  }, [camera, centerY, layout, size.height, size.width, view])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      euler: new THREE.Euler(),
      color: new THREE.Color(),
      blockCrack: new Float32Array(Math.max(1, model.blocks.length)),
    }),
    [model],
  )

  /** Distance from the column top to a document position, noise slabs included. */
  const offsetOf = (pos: number): number => {
    const blocks = model.blocks
    let low = 0
    let high = blocks.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if ((blocks[mid]?.start ?? 0) <= pos) low = mid
      else high = mid - 1
    }
    const block = blocks[low]
    if (!block) return 0
    return (layout.blockTop[low] ?? 0) + (pos - block.start) * layout.scale
  }

  useFrame((_state, delta) => {
    const p = Math.min(1, Math.max(0, progressRef.current))
    const settle = reduced ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 6)
    const top = layout.height / 2
    const { matrix, position, quaternion, scale, euler, color, blockCrack } = scratch

    // Column positions for the current view (animated).
    const target = {
      naive: view === 'both' ? -SIDE_X : 0,
      smart: view === 'both' ? SIDE_X : 0,
      naiveScale: view === 'smart' ? 0 : 1,
      smartScale: view === 'naive' ? 0 : 1,
    }
    const col = columnX.current
    col.naive = lerp(col.naive, target.naive, settle)
    col.smart = lerp(col.smart, target.smart, settle)
    col.naiveScale = lerp(col.naiveScale, target.naiveScale, settle)
    col.smartScale = lerp(col.smartScale, target.smartScale, settle)

    const bladeT = smoothstep(0.06, 0.55, p)
    const bladeY = top + 0.3 - bladeT * (layout.height + 0.6)
    const openNaive = smoothstep(0.6, 0.88, p)
    const noiseOut = smoothstep(0.1, 0.4, p)
    const group = smoothstep(0.5, 0.85, p)

    // Traditional column -----------------------------------------------------------------------
    const naiveMesh = naiveMeshRef.current
    if (naiveMesh) {
      blockCrack.fill(0)
      model.segments.forEach((segment) => {
        if (!segment.cutAbove) return
        const cutY = top - offsetOf(segment.start)
        const crack = bladeY < cutY ? smoothstep(0, 0.5, cutY - bladeY) : 0
        blockCrack[segment.block] = Math.max(blockCrack[segment.block] ?? 0, crack)
      })
      model.segments.forEach((segment, index) => {
        const block = model.blocks[segment.block]
        if (!block) return
        const segTop = top - offsetOf(segment.start)
        const segH = Math.max(0.01, (segment.end - segment.start) * layout.scale)
        const crack = segment.cutAbove
          ? bladeY < segTop
            ? smoothstep(0, 0.5, segTop - bladeY)
            : 0
          : 0
        const sign = segment.naiveIndex % 2 === 0 ? -1 : 1
        const width = WIDTH[block.chunk.type]
        position.set(
          col.naive - COLUMN_W / 2 + width / 2 + sign * 0.1 * crack * (1 - openNaive * 0.6),
          segTop -
            segH / 2 -
            segment.naiveIndex * GAP_NAIVE * openNaive -
            (segment.cutAbove ? 0.03 * crack : 0),
          0,
        )
        euler.set(0, 0, sign * 0.05 * crack * (1 - openNaive))
        quaternion.setFromEuler(euler)
        scale.set(
          width * col.naiveScale,
          Math.max(0.0001, (segH - 0.012) * col.naiveScale),
          DEPTH * col.naiveScale,
        )
        matrix.compose(position, quaternion, scale)
        naiveMesh.setMatrixAt(index, matrix)
        color.copy(colors.types[block.chunk.type])
        const crackColour = block.split ? (blockCrack[segment.block] ?? 0) : 0
        if (crackColour > 0) color.lerp(colors.bad, crackColour * (block.structural ? 0.85 : 0.5))
        if (selectedBlock === segment.block) color.lerp(colors.fg, 0.35)
        naiveMesh.setColorAt(index, color)
      })
      model.noise.forEach((_, k) => {
        const index = segmentCount + k
        const y =
          top -
          (layout.noiseTop[k] ?? 0) -
          layout.noiseH / 2 -
          (layout.noiseNaive[k] ?? 0) * GAP_NAIVE * openNaive
        position.set(col.naive - COLUMN_W / 2 + (COLUMN_W * 0.85) / 2, y, 0)
        quaternion.identity()
        scale.set(
          COLUMN_W * 0.85 * col.naiveScale,
          Math.max(0.0001, (layout.noiseH - 0.02) * col.naiveScale),
          DEPTH * 0.7 * col.naiveScale,
        )
        matrix.compose(position, quaternion, scale)
        naiveMesh.setMatrixAt(index, matrix)
        naiveMesh.setColorAt(index, colors.noise)
      })
      naiveMesh.instanceMatrix.needsUpdate = true
      if (naiveMesh.instanceColor) naiveMesh.instanceColor.needsUpdate = true
      naiveMesh.computeBoundingSphere()
    }

    // Cut markers --------------------------------------------------------------------------------
    const cutMesh = cutMeshRef.current
    if (cutMesh) {
      model.cuts.forEach((cut, index) => {
        const cutY = top - offsetOf(cut.pos)
        const reveal = bladeY < cutY ? smoothstep(0, 0.35, cutY - bladeY) : 0
        const block = cut.block === null ? undefined : model.blocks[cut.block]
        position.set(
          col.naive,
          cutY - cut.naiveIndex * GAP_NAIVE * openNaive + (GAP_NAIVE * openNaive) / 2,
          0.02,
        )
        quaternion.identity()
        const visible = reveal * col.naiveScale
        scale.set(
          Math.max(0.0001, (COLUMN_W + 0.7) * visible),
          cut.inside ? 0.035 : 0.02,
          Math.max(0.0001, (DEPTH + 0.12) * visible),
        )
        matrix.compose(position, quaternion, scale)
        cutMesh.setMatrixAt(index, matrix)
        const tone = !cut.inside ? colors.muted : block?.split ? colors.bad : colors.fg
        cutMesh.setColorAt(index, tone)
      })
      cutMesh.instanceMatrix.needsUpdate = true
      if (cutMesh.instanceColor) cutMesh.instanceColor.needsUpdate = true
    }

    const blade = bladeRef.current
    if (blade) {
      const active = p > 0.04 && p < 0.58 && view !== 'smart'
      blade.position.set(col.naive, bladeY, 0)
      blade.scale.setScalar(lerp(blade.scale.x, active ? 1 : 0.0001, reduced ? 1 : 0.3))
    }

    // SmartChunk column ---------------------------------------------------------------------------
    const smartMesh = smartMeshRef.current
    const blockY: number[] = []
    if (smartMesh) {
      model.blocks.forEach((block, index) => {
        const h = Math.max(0.01, (block.end - block.start) * layout.scale)
        const withNoise = top - (layout.blockTop[index] ?? 0) - h / 2
        const clean = top - (layout.blockTopClean[index] ?? 0) - h / 2
        const y =
          lerp(withNoise, clean, noiseOut) -
          (index * GAP_SMART + block.sectionIndex * GAP_SECTION) * group
        blockY[index] = y
        const width = WIDTH[block.chunk.type]
        position.set(col.smart - COLUMN_W / 2 + width / 2, y, 0)
        quaternion.identity()
        scale.set(
          width * col.smartScale,
          Math.max(0.0001, (h - 0.012) * col.smartScale),
          DEPTH * col.smartScale,
        )
        matrix.compose(position, quaternion, scale)
        smartMesh.setMatrixAt(index, matrix)
        color.copy(colors.types[block.chunk.type])
        if (selectedBlock === index) color.lerp(colors.fg, 0.35)
        smartMesh.setColorAt(index, color)
      })
      model.noise.forEach((_, k) => {
        const index = model.blocks.length + k
        const startY = top - (layout.noiseTop[k] ?? 0) - layout.noiseH / 2
        const fly = noiseOut
        position.set(
          col.smart - COLUMN_W / 2 + (COLUMN_W * 0.85) / 2 + fly * (3.5 + (k % 3)),
          startY + fly * (1.2 + (k % 4) * 0.4),
          fly * 1.5,
        )
        euler.set(fly * 1.2, fly * (0.8 + k * 0.1), fly * 0.6)
        quaternion.setFromEuler(euler)
        const shrink = (1 - fly) * col.smartScale
        scale.set(
          Math.max(0.0001, COLUMN_W * 0.85 * shrink),
          Math.max(0.0001, (layout.noiseH - 0.02) * shrink),
          Math.max(0.0001, DEPTH * 0.7 * shrink),
        )
        matrix.compose(position, quaternion, scale)
        smartMesh.setMatrixAt(index, matrix)
        smartMesh.setColorAt(index, colors.noise)
      })
      smartMesh.instanceMatrix.needsUpdate = true
      if (smartMesh.instanceColor) smartMesh.instanceColor.needsUpdate = true
      smartMesh.computeBoundingSphere()
    }

    // Section frames ------------------------------------------------------------------------------
    resources.frameMaterial.opacity = group * 0.9 * col.smartScale
    model.sections.forEach((section, index) => {
      const frame = frameRefs.current[index]
      if (!frame) return
      const first = model.blocks[section.first]
      const last = model.blocks[section.last]
      if (!first || !last) return
      const firstH = (first.end - first.start) * layout.scale
      const lastH = (last.end - last.start) * layout.scale
      const topY = (blockY[section.first] ?? 0) + firstH / 2
      const bottomY = (blockY[section.last] ?? 0) - lastH / 2
      frame.position.set(col.smart, (topY + bottomY) / 2, 0)
      frame.scale.set(COLUMN_W + 0.3, Math.max(0.01, topY - bottomY + 0.14), DEPTH + 0.25)
      frame.visible = group > 0.02 && col.smartScale > 0.05
    })
  })

  const pick = (method: Method) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const id = event.instanceId
    if (id === undefined) return
    if (method === 'naive') {
      const segment = model.segments[id]
      onHover({
        method,
        block: segment ? segment.block : null,
        naiveIndex: segment ? segment.naiveIndex : null,
        noise: segment ? null : id - segmentCount,
        clientX: event.nativeEvent.clientX,
        clientY: event.nativeEvent.clientY,
      })
    } else {
      const isBlock = id < model.blocks.length
      onHover({
        method,
        block: isBlock ? id : null,
        naiveIndex: null,
        noise: isBlock ? null : id - model.blocks.length,
        clientX: event.nativeEvent.clientX,
        clientY: event.nativeEvent.clientY,
      })
    }
  }

  const click = (method: Method) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const id = event.instanceId
    if (id === undefined) return
    if (method === 'naive') onSelect(model.segments[id]?.block ?? null)
    else onSelect(id < model.blocks.length ? id : null)
  }

  return (
    <>
      <color attach="background" args={[colors.bg]} />
      <fog attach="fog" args={[colors.bg, 30, 140]} />
      <hemisphereLight args={['#ffffff', colors.bg, 0.9]} />
      <directionalLight position={[6, 10, 12]} intensity={1.6} />
      <directionalLight position={[-8, -4, -6]} intensity={0.7} color={colors.accent} />

      <instancedMesh
        key={`naive-${naiveCount}`}
        ref={naiveMeshRef}
        args={[resources.slab, resources.slabMaterial, Math.max(1, naiveCount)]}
        frustumCulled={false}
        onPointerMove={pick('naive')}
        onPointerOut={() => onHover(null)}
        onClick={click('naive')}
      />
      <instancedMesh
        key={`smart-${smartCount}`}
        ref={smartMeshRef}
        args={[resources.slab, resources.smartMaterial, Math.max(1, smartCount)]}
        frustumCulled={false}
        onPointerMove={pick('smart')}
        onPointerOut={() => onHover(null)}
        onClick={click('smart')}
      />
      <instancedMesh
        key={`cuts-${cutCount}`}
        ref={cutMeshRef}
        args={[resources.bar, resources.cutMaterial, cutCount]}
        frustumCulled={false}
      />

      <group ref={bladeRef} scale={0.0001}>
        <mesh scale={[COLUMN_W + 1.2, 0.04, DEPTH + 0.5]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={colors.fg} toneMapped={false} />
        </mesh>
        <mesh scale={[COLUMN_W + 2, 0.5, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={colors.bad} transparent opacity={0.14} depthWrite={false} />
        </mesh>
      </group>

      {model.sections.map((section, index) => (
        <lineSegments
          key={`${section.name}-${index}`}
          ref={(element) => {
            frameRefs.current[index] = element
          }}
          geometry={resources.edges}
          material={resources.frameMaterial}
          visible={false}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={3}
        onStart={() => onHover(null)}
      />
    </>
  )
}
