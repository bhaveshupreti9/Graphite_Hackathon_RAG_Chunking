// Landing 3D scene. One instanced mesh draws two copies of the same document as pairs of half-blocks:
//   copy 0 = Traditional: a blade sweeps down and blindly cracks every block a cut line crosses (red);
//   copy 1 = SmartChunk: blocks stay whole and snap into labelled section groups (green frames).
// The `stage` prop (0..5: Problem, LLM, Context window, RAG, Vector DB, Solution) rearranges the
// same blocks for each part of the scroll story.

import { Html, Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { cn } from '@/lib/cn'
import { token, typeToken } from '@/lib/palette'
import { BLOCKS, COLUMN, CUTS, GROUPED, MAX_W, SECTIONS, rand, sectionBounds } from './docModel'

export const STAGE_COUNT = 6

const S = 0.62 // document units -> scene units
const DEPTH = 0.22
const PERIOD = 7.5 // seconds per blade sweep / regroup loop
const N = BLOCKS.length
const COUNT = N * 4 // 2 copies x N blocks x 2 halves
const DOC_X = 2.45 // distance of each copy from the centre in the Problem stage
const STRUCTURAL_SELECTED = [3, 6, 10] // code blocks retrieved in the RAG stage
const CONTEXT_WINDOW_HALF = 1.65

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const yIn = (layout: typeof COLUMN, index: number): number =>
  (layout.height / 2 - ((layout.tops[index] ?? 0) + (BLOCKS[index]?.h ?? 0) / 2)) * S
const xLeftAligned = (centerX: number, index: number): number =>
  centerX - (MAX_W * S) / 2 + ((BLOCKS[index]?.w ?? 0) * S) / 2

const SECTION_BOUNDS = sectionBounds(GROUPED)

const CLUSTERS: Record<string, THREE.Vector3> = {
  prose: new THREE.Vector3(-2.3, 0.9, 0),
  code: new THREE.Vector3(1.9, 1.35, -0.8),
  table: new THREE.Vector3(0.2, -1.55, 1.0),
  list: new THREE.Vector3(2.5, -1.0, 1.6),
}

const GRID_POS = (index: number): THREE.Vector3 => {
  const col = index % 3
  const row = Math.floor(index / 3)
  return new THREE.Vector3(1.0 + col * 1.75, 2.0 - row * 1.3, 0)
}

const QUESTION_POS = new THREE.Vector3(-3.7, 1.25, 0.6)
const LLM_RAG_POS = new THREE.Vector3(-3.7, -1.35, 0)

interface BlockState {
  pos: THREE.Vector3
  size: THREE.Vector3
  rotY: number
  rotZ: number
  color: THREE.Color
}

interface LabelProps {
  position: [number, number, number]
  visible: boolean
  tone?: 'default' | 'good' | 'bad' | 'accent'
  children: ReactNode
}

function Label({ position, visible, tone = 'default', children }: LabelProps) {
  return (
    <Html position={position} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div
        aria-hidden="true"
        className={cn(
          'whitespace-nowrap rounded-full border bg-bg/80 px-2.5 py-1 text-xs font-medium backdrop-blur transition-opacity duration-500',
          visible ? 'opacity-100' : 'opacity-0',
          tone === 'good' && 'border-good/50 text-good',
          tone === 'bad' && 'border-bad/50 text-bad',
          tone === 'accent' && 'border-accent/60 text-fg',
          tone === 'default' && 'border-border text-fg',
        )}
      >
        {children}
      </div>
    </Html>
  )
}

interface HeroSceneProps {
  stage: number
  reduced: boolean
  compact: boolean
}

export function HeroScene({ stage, reduced, compact }: HeroSceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const bladeRef = useRef<THREE.Group>(null)
  const sphereRef = useRef<THREE.Group>(null)
  const orbRef = useRef<THREE.Mesh>(null)
  const windowRef = useRef<THREE.LineSegments>(null)
  const frameRefs = useRef<(THREE.LineSegments | null)[]>([])
  const cloudLabelsRef = useRef<THREE.Group>(null)
  const dustRef = useRef<THREE.Points>(null)
  const stageAge = useRef(0)
  const crackWeight = useRef(1)
  const frameOpacity = useRef(0)
  const windowOpacity = useRef(0)
  const invalidate = useThree((state) => state.invalidate)

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
      accent: new THREE.Color(token('accent')),
      fg: new THREE.Color(token('fg')),
      muted: new THREE.Color(token('muted')),
      bg: new THREE.Color(token('bg')),
    }),
    [],
  )

  const resources = useMemo(() => {
    const block = new RoundedBoxGeometry(1, 1, 1, 2, 0.07)
    const blockMaterial = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.08 })
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const frameMaterial = new THREE.LineBasicMaterial({
      color: colors.good,
      transparent: true,
      opacity: 0,
    })
    const windowMaterial = new THREE.LineBasicMaterial({
      color: colors.accent,
      transparent: true,
      opacity: 0,
    })
    const dustPositions = new Float32Array(240 * 3)
    for (let i = 0; i < 240; i += 1) {
      dustPositions[i * 3] = (rand(i, 1) - 0.5) * 22
      dustPositions[i * 3 + 1] = (rand(i, 2) - 0.5) * 12
      dustPositions[i * 3 + 2] = (rand(i, 3) - 0.5) * 10 - 2
    }
    const dust = new THREE.BufferGeometry()
    dust.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))
    const dustMaterial = new THREE.PointsMaterial({
      color: colors.muted,
      size: 0.035,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })
    return { block, blockMaterial, edges, frameMaterial, windowMaterial, dust, dustMaterial }
  }, [colors])

  useEffect(
    () => () => {
      Object.values(resources).forEach((resource) => resource.dispose())
    },
    [resources],
  )

  // Current (animated) state of every block of both copies.
  const states = useMemo<BlockState[][]>(
    () =>
      [0, 1].map((copy) =>
        BLOCKS.map((block, index) => ({
          pos: new THREE.Vector3(
            xLeftAligned(copy === 0 ? -DOC_X : DOC_X, index),
            yIn(COLUMN, index),
            0,
          ),
          size: new THREE.Vector3(block.w * S, block.h * S, DEPTH),
          rotY: 0,
          rotZ: 0,
          color: colors.types[block.type].clone(),
        })),
      ),
    [colors],
  )

  // Scratch objects reused every frame (no allocations in the render loop).
  const scratch = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      size: new THREE.Vector3(),
      color: new THREE.Color(),
      pieceColor: new THREE.Color(),
      blockMatrix: new THREE.Matrix4(),
      localMatrix: new THREE.Matrix4(),
      outMatrix: new THREE.Matrix4(),
      blockQuat: new THREE.Quaternion(),
      localQuat: new THREE.Quaternion(),
      localPos: new THREE.Vector3(),
      localScale: new THREE.Vector3(),
      euler: new THREE.Euler(),
      one: new THREE.Vector3(1, 1, 1),
      target: new THREE.Vector3(),
    }),
    [],
  )

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < COUNT; i += 1) mesh.setColorAt(i, colors.fg)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [colors])

  useEffect(() => {
    stageAge.current = 0
    invalidate()
  }, [stage, invalidate])

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = Math.min(delta, 0.1)
    stageAge.current += dt
    const time = reduced ? PERIOD * 0.8 : state.clock.elapsedTime
    const settle = reduced ? 1 : 1 - Math.exp(-dt * 4.2)
    const follow = reduced || stageAge.current > 1.3 ? 1 : settle
    const continuous = stage === 1 || stage === 2 || stage === 4

    const phase = (time % PERIOD) / PERIOD
    const grouped = smoothstep(0.32, 0.5, phase) * (1 - smoothstep(0.9, 0.98, phase))
    const resetK = 1 - smoothstep(0.9, 0.98, phase)
    const bladeOffset = phase * (COLUMN.height + 1.4) - 0.7
    crackWeight.current = lerp(crackWeight.current, stage === 0 ? 1 : 0, settle)
    const cloudAngle = time * 0.12
    const cos = Math.cos(cloudAngle)
    const sin = Math.sin(cloudAngle)
    const { pos, size, color } = scratch

    for (let copy = 0; copy < 2; copy += 1) {
      for (let b = 0; b < N; b += 1) {
        const block = BLOCKS[b]
        const current = states[copy]?.[b]
        if (!block || !current) continue
        const typeColor = colors.types[block.type]
        let rotY = 0
        const rotZ = 0
        color.copy(typeColor)
        size.set(block.w * S, block.h * S, DEPTH)
        const bob = reduced ? 0 : Math.sin(time * 0.9 + b * 0.8) * 0.035

        if (stage === 0) {
          if (copy === 0) {
            pos.set(xLeftAligned(-DOC_X, b), yIn(COLUMN, b) + bob, 0)
          } else {
            pos.set(
              xLeftAligned(DOC_X, b) + 0.12 * grouped,
              lerp(yIn(COLUMN, b), yIn(GROUPED, b), grouped) + bob,
              0,
            )
          }
        } else if (stage === 5 && copy === 1) {
          pos.set(xLeftAligned(0, b), yIn(GROUPED, b) + bob, 0)
          rotY = reduced ? 0 : Math.sin(time * 0.4) * 0.08
        } else if (stage === 1 && copy === 1) {
          const u = (b / N + time * 0.06) % 1
          const radius = 0.7 + 3.6 * (1 - u)
          const angle = u * Math.PI * 3 + b * 0.7
          pos.set(
            radius * Math.cos(angle),
            (1 - u) * 2.4 - 1.2 + Math.sin(b) * 0.4,
            radius * Math.sin(angle) * 0.55,
          )
          const grow = smoothstep(0, 0.12, u) * (1 - u * 0.75) * (1 - smoothstep(0.85, 1, u))
          size.multiplyScalar(Math.max(0.0001, grow))
          rotY = angle
        } else if (stage === 2 && copy === 1) {
          const loop = COLUMN.height + 1.4
          const offset = (time * 0.32) % loop
          let docY = (COLUMN.tops[b] ?? 0) + block.h / 2 - offset
          if (docY < -0.7) docY += loop
          const y = (COLUMN.height / 2 - docY) * S - 0.6
          pos.set(xLeftAligned(0, b), y, 0)
          const edge = Math.min(docY + 0.7, loop - 0.7 - docY)
          size.multiplyScalar(Math.max(0.0001, smoothstep(0, 0.6, edge)))
          const inside = Math.abs(y) + (block.h * S) / 2 <= CONTEXT_WINDOW_HALF + 0.02
          if (!inside) color.multiplyScalar(0.22)
        } else if (stage === 3 && copy === 1) {
          pos.copy(GRID_POS(b))
          size.set(Math.min(1.5, block.w * S * 0.62), Math.min(0.75, block.h * S * 0.75), DEPTH)
          if (STRUCTURAL_SELECTED.includes(b)) {
            pos.x -= 0.45
            pos.z += 0.9
            pos.y += bob * 2
            color.multiplyScalar(1.15)
          } else {
            color.multiplyScalar(0.3)
          }
        } else if (stage === 4) {
          const center = CLUSTERS[block.type] ?? CLUSTERS.prose
          if (!center) continue
          const salt = copy * 10
          const x = center.x + (rand(b, 4 + salt) - 0.5) * 1.3
          const y = center.y + (rand(b, 5 + salt) - 0.5) * 1.1
          const z = center.z + (rand(b, 6 + salt) - 0.5) * 1.3
          pos.set(x * cos + z * sin, y, -x * sin + z * cos)
          const cube = copy === 0 ? 0.26 : 0.38
          size.set(cube, cube, cube)
          rotY = cloudAngle + b
        } else {
          // Hidden in this stage: shrink into the centre.
          pos.set(0, 0, -1.5)
          size.set(0.0001, 0.0001, 0.0001)
        }

        const k = continuous ? follow : settle
        current.pos.lerp(pos, k)
        current.size.lerp(size, k)
        current.rotY = lerp(current.rotY, rotY, k)
        current.rotZ = lerp(current.rotZ, rotZ, k)
        current.color.lerp(color, settle)

        // Crack amount for the Traditional copy (only while the blade has passed this block).
        const cut = CUTS[b] ?? null
        let crack = 0
        if (copy === 0 && cut !== null) {
          const passed = bladeOffset - ((COLUMN.tops[b] ?? 0) + cut)
          crack = smoothstep(0, 0.45, passed) * resetK * crackWeight.current
        }
        const severity = block.type === 'prose' ? 0.45 : 0.9

        scratch.euler.set(0, current.rotY, current.rotZ)
        scratch.blockQuat.setFromEuler(scratch.euler)
        scratch.blockMatrix.compose(current.pos, scratch.blockQuat, scratch.one)

        const topFraction = cut === null ? 0.5 : cut / block.h
        for (let half = 0; half < 2; half += 1) {
          const index = copy * N * 2 + b * 2 + half
          const split = crack > 0.002
          const fraction = split ? (half === 0 ? topFraction : 1 - topFraction) : half === 0 ? 1 : 0
          const pieceHeight = Math.max(0.0001, current.size.y * fraction)
          const offsetY = split
            ? half === 0
              ? current.size.y / 2 - pieceHeight / 2
              : -current.size.y / 2 + pieceHeight / 2
            : 0
          const direction = half === 0 ? 1 : -1
          scratch.localPos.set(
            (half === 0 ? -0.07 : 0.1) * crack,
            offsetY + direction * 0.17 * crack,
            0,
          )
          scratch.euler.set(0, 0, (half === 0 ? 0.08 : -0.06) * crack)
          scratch.localQuat.setFromEuler(scratch.euler)
          scratch.localScale.set(
            fraction === 0 ? 0.0001 : current.size.x,
            pieceHeight,
            fraction === 0 ? 0.0001 : current.size.z,
          )
          scratch.localMatrix.compose(scratch.localPos, scratch.localQuat, scratch.localScale)
          scratch.outMatrix.multiplyMatrices(scratch.blockMatrix, scratch.localMatrix)
          mesh.setMatrixAt(index, scratch.outMatrix)
          scratch.pieceColor.copy(current.color)
          if (crack > 0) scratch.pieceColor.lerp(colors.bad, crack * severity)
          mesh.setColorAt(index, scratch.pieceColor)
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    // Blade (Problem stage only).
    const blade = bladeRef.current
    if (blade) {
      const visible = stage === 0 && bladeOffset > -0.6 && bladeOffset < COLUMN.height + 0.6
      blade.position.set(-DOC_X, (COLUMN.height / 2 - bladeOffset) * S, 0)
      const scaleTarget = visible ? 1 : 0.0001
      blade.scale.setScalar(lerp(blade.scale.x, scaleTarget, reduced ? 1 : 0.25))
    }

    // LLM sphere (LLM and RAG stages).
    const sphere = sphereRef.current
    if (sphere) {
      const target = stage === 1 ? 1 : stage === 3 ? 0.6 : 0.0001
      sphere.scale.setScalar(lerp(sphere.scale.x, target, settle))
      scratch.target.set(0, 0, 0)
      if (stage === 3) scratch.target.copy(LLM_RAG_POS)
      sphere.position.lerp(scratch.target, settle)
      if (!reduced) sphere.rotation.y += dt * 0.35
    }

    // Question orb (RAG stage) / query point (Vector DB stage).
    const orb = orbRef.current
    if (orb) {
      const target = stage === 3 || stage === 4 ? 1 : 0.0001
      orb.scale.setScalar(lerp(orb.scale.x, target, settle))
      if (stage === 3) scratch.target.copy(QUESTION_POS)
      else {
        const code = CLUSTERS.code ?? QUESTION_POS
        const x = code.x - 0.9
        const z = code.z + 0.6
        scratch.target.set(x * cos + z * sin, code.y + 0.3, -x * sin + z * cos)
      }
      orb.position.lerp(scratch.target, stage === 4 ? follow : settle)
    }

    // Context window frame.
    windowOpacity.current = lerp(windowOpacity.current, stage === 2 ? 0.9 : 0, settle)
    resources.windowMaterial.opacity = windowOpacity.current
    const windowFrame = windowRef.current
    if (windowFrame) windowFrame.visible = windowOpacity.current > 0.01

    // Section frames (SmartChunk groups).
    const frameTarget = stage === 0 ? grouped : stage === 5 ? 1 : 0
    frameOpacity.current = lerp(frameOpacity.current, frameTarget, stage === 0 ? 1 : settle)
    resources.frameMaterial.opacity = frameOpacity.current * 0.9
    frameRefs.current.forEach((frame, section) => {
      const bounds = SECTION_BOUNDS[section]
      if (!frame || !bounds) return
      const centerX = stage === 5 ? 0 : DOC_X + 0.12
      const y = (GROUPED.height / 2 - (bounds.top + bounds.bottom) / 2) * S
      frame.position.x = lerp(frame.position.x, centerX, settle)
      frame.position.y = y
      frame.scale.set(MAX_W * S + 0.36, (bounds.bottom - bounds.top) * S + 0.26, DEPTH + 0.3)
      frame.visible = frameOpacity.current > 0.01
    })

    if (cloudLabelsRef.current) cloudLabelsRef.current.rotation.y = cloudAngle

    if (dustRef.current && !reduced) dustRef.current.rotation.y += dt * 0.01

    if (!reduced) {
      const camera = state.camera
      camera.position.x = lerp(camera.position.x, state.pointer.x * 0.7, 0.04)
      camera.position.y = lerp(camera.position.y, state.pointer.y * 0.35, 0.04)
      camera.lookAt(0, 0, 0)
    }
  })

  const offsetX = compact ? 0 : 2.2
  const groupScale = compact ? 0.82 : 1
  const columnTop = (COLUMN.height * S) / 2
  const groupedTop = (GROUPED.height * S) / 2
  const ragLines = STRUCTURAL_SELECTED.map((index) => {
    const end = GRID_POS(index)
    return [QUESTION_POS.toArray(), [end.x - 0.45 - 0.6, end.y, end.z + 0.9]] as [
      [number, number, number],
      [number, number, number],
    ]
  })

  return (
    <>
      <fog attach="fog" args={[colors.bg, 13, 26]} />
      <hemisphereLight args={['#ffffff', colors.bg, 0.85]} />
      <directionalLight position={[5, 6, 8]} intensity={1.7} />
      <directionalLight position={[-6, -3, -4]} intensity={0.9} color={colors.accent} />

      <points ref={dustRef} geometry={resources.dust} material={resources.dustMaterial} />

      <group position={[offsetX, compact ? 0.4 : 0, 0]} scale={groupScale}>
        <instancedMesh
          ref={meshRef}
          args={[resources.block, resources.blockMaterial, COUNT]}
          frustumCulled={false}
        />

        <group ref={bladeRef}>
          <mesh scale={[MAX_W * S + 0.9, 0.03, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={colors.fg} toneMapped={false} />
          </mesh>
          <mesh scale={[MAX_W * S + 1.4, 0.32, 1]}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color={colors.bad} transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </group>

        <group ref={sphereRef} scale={0.0001}>
          <mesh>
            <icosahedronGeometry args={[0.95, 3]} />
            <meshStandardMaterial
              color={colors.accent}
              emissive={colors.accent}
              emissiveIntensity={0.55}
              roughness={0.3}
            />
          </mesh>
          <mesh scale={1.3}>
            <icosahedronGeometry args={[0.95, 1]} />
            <meshBasicMaterial color={colors.accent} wireframe transparent opacity={0.35} />
          </mesh>
        </group>

        <mesh ref={orbRef} scale={0.0001}>
          <sphereGeometry args={[0.22, 24, 24]} />
          <meshStandardMaterial
            color={colors.fg}
            emissive={colors.accent}
            emissiveIntensity={1.2}
          />
        </mesh>

        <lineSegments
          ref={windowRef}
          geometry={resources.edges}
          material={resources.windowMaterial}
          position={[0, 0, 0]}
          scale={[MAX_W * S + 0.6, CONTEXT_WINDOW_HALF * 2, 0.7]}
          visible={false}
        />

        {SECTIONS.map((section, index) => (
          <lineSegments
            key={section}
            ref={(element) => {
              frameRefs.current[index] = element
            }}
            geometry={resources.edges}
            material={resources.frameMaterial}
            visible={false}
          />
        ))}

        {stage === 3
          ? ragLines.map((points, index) => (
              <Line
                key={index}
                points={points}
                color={colors.accent}
                lineWidth={1.4}
                transparent
                opacity={0.75}
                dashed
                dashSize={0.18}
                gapSize={0.1}
              />
            ))
          : null}

        <Label position={[-DOC_X, columnTop + 0.45, 0]} visible={stage === 0} tone="bad">
          Traditional: a cut every N tokens
        </Label>
        <Label position={[DOC_X, groupedTop + 0.45, 0]} visible={stage === 0} tone="good">
          SmartChunk: cuts at structure
        </Label>
        <Label position={[0, -1.55, 0]} visible={stage === 1} tone="accent">
          LLM
        </Label>
        <Label position={[0, CONTEXT_WINDOW_HALF + 0.4, 0]} visible={stage === 2} tone="accent">
          Context window: 8,192 tokens
        </Label>
        <Label
          position={[QUESTION_POS.x, QUESTION_POS.y + 0.55, 0.6]}
          visible={stage === 3}
          tone="accent"
        >
          Question
        </Label>
        <Label
          position={[LLM_RAG_POS.x, LLM_RAG_POS.y - 0.85, 0]}
          visible={stage === 3}
          tone="accent"
        >
          LLM + top-k chunks
        </Label>
        <Label position={[2.75, 2.85, 0]} visible={stage === 3}>
          Vector store
        </Label>
        {SECTIONS.map((section, index) => {
          const bounds = SECTION_BOUNDS[index]
          if (!bounds) return null
          return (
            <Label
              key={section}
              position={[-(MAX_W * S) / 2 - 1.05, (GROUPED.height / 2 - bounds.top) * S - 0.12, 0]}
              visible={stage === 5}
              tone="good"
            >
              {section}
            </Label>
          )
        })}
        <group ref={cloudLabelsRef}>
          {Object.entries(CLUSTERS).map(([type, center]) => (
            <Label key={type} position={[center.x, center.y + 1.0, center.z]} visible={stage === 4}>
              {type}
            </Label>
          ))}
        </group>
      </group>
    </>
  )
}
