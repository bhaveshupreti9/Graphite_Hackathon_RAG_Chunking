// 3D processing pipeline: one node per step in PART A8. The active node is lit from the real `step`,
// finished nodes turn green, and the track fills with the real `progress` value.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { token } from '@/lib/palette'
import type { ProcessStep, ProcessingStatus } from '@/types/api'

const PIPELINE_NODES: readonly { step: ProcessStep; progress: number }[] = [
  { step: 'parsing', progress: 10 },
  { step: 'cleaning', progress: 25 },
  { step: 'semantic_split', progress: 40 },
  { step: 'dedup', progress: 60 },
  { step: 'embedding', progress: 70 },
  { step: 'storing', progress: 85 },
  { step: 'summarizing', progress: 92 },
]

const SPACING = 2
const X0 = -((PIPELINE_NODES.length - 1) * SPACING) / 2
const PARTICLES = 16

const nodeX = (index: number): number => X0 + index * SPACING

/** Track position (x) for a progress value, interpolated between the nodes' start values. */
function progressX(progress: number): number {
  const first = PIPELINE_NODES[0]
  if (!first || progress <= first.progress) return X0
  for (let i = 0; i < PIPELINE_NODES.length - 1; i += 1) {
    const current = PIPELINE_NODES[i]
    const next = PIPELINE_NODES[i + 1]
    if (current && next && progress < next.progress) {
      return (
        nodeX(i) + ((progress - current.progress) / (next.progress - current.progress)) * SPACING
      )
    }
  }
  return nodeX(PIPELINE_NODES.length - 1)
}

interface PipelineSceneProps {
  step: ProcessStep
  progress: number
  status: ProcessingStatus['status']
  reduced: boolean
}

export function PipelineScene({ step, progress, status, reduced }: PipelineSceneProps) {
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([])
  const fillRef = useRef<THREE.Mesh>(null)
  const particlesRef = useRef<THREE.InstancedMesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const fillX = useRef(X0)
  const invalidate = useThree((state) => state.invalidate)

  const colors = useMemo(
    () => ({
      accent: new THREE.Color(token('accent')),
      good: new THREE.Color(token('good')),
      bad: new THREE.Color(token('bad')),
      idle: new THREE.Color(token('muted')).multiplyScalar(0.45),
      border: new THREE.Color(token('border')),
      fg: new THREE.Color(token('fg')),
      bg: new THREE.Color(token('bg')),
      black: new THREE.Color(0, 0, 0),
    }),
    [],
  )

  const resources = useMemo(() => {
    const node = new RoundedBoxGeometry(1, 1, 1, 3, 0.16)
    const nodeMaterials = PIPELINE_NODES.map(
      () => new THREE.MeshStandardMaterial({ color: colors.idle, roughness: 0.35, metalness: 0.1 }),
    )
    const track = new THREE.CylinderGeometry(0.045, 0.045, 1, 12)
    const trackMaterial = new THREE.MeshStandardMaterial({ color: colors.border, roughness: 0.6 })
    const fillMaterial = new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.8,
    })
    const particle = new THREE.SphereGeometry(0.06, 10, 10)
    const particleMaterial = new THREE.MeshBasicMaterial({ color: colors.fg, toneMapped: false })
    return { node, nodeMaterials, track, trackMaterial, fillMaterial, particle, particleMaterial }
  }, [colors])

  useEffect(
    () => () => {
      resources.node.dispose()
      resources.nodeMaterials.forEach((material) => material.dispose())
      resources.track.dispose()
      resources.trackMaterial.dispose()
      resources.fillMaterial.dispose()
      resources.particle.dispose()
      resources.particleMaterial.dispose()
    },
    [resources],
  )

  useEffect(() => {
    invalidate()
  }, [step, progress, status, invalidate])

  const scratch = useMemo(() => ({ matrix: new THREE.Matrix4(), color: new THREE.Color() }), [])
  const activeIndex = PIPELINE_NODES.findIndex((node) => node.step === step)

  useFrame((state, delta) => {
    // Fit the whole pipeline (about 15 units wide) to the canvas width at any aspect ratio.
    const camera = state.camera as THREE.PerspectiveCamera
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const fitZ = Math.max(4, 15.5 / (2 * Math.tan(halfFov) * Math.max(0.5, camera.aspect)))
    if (Math.abs(camera.position.z - fitZ) > 0.01) {
      camera.position.set(0, fitZ * 0.16, fitZ)
      camera.lookAt(0, 0, 0)
    }
    const time = state.clock.elapsedTime
    const settle = reduced ? 1 : 1 - Math.exp(-Math.min(delta, 0.1) * 5)
    const allDone = status === 'done' || step === 'done'

    PIPELINE_NODES.forEach((_, index) => {
      const mesh = nodeRefs.current[index]
      const material = resources.nodeMaterials[index]
      if (!mesh || !material) return
      const isActive = !allDone && index === activeIndex && status !== 'idle'
      const isDone = allDone || (activeIndex > -1 && index < activeIndex)
      const target = isActive
        ? status === 'error'
          ? colors.bad
          : colors.accent
        : isDone
          ? colors.good
          : colors.idle
      material.color.lerp(target, settle)
      scratch.color.copy(isActive ? target : colors.black)
      material.emissive.lerp(scratch.color, settle)
      material.emissiveIntensity = isActive ? 0.6 + (reduced ? 0 : Math.sin(time * 4) * 0.25) : 0
      const pulse = isActive && !reduced && status === 'running' ? 1 + Math.sin(time * 4) * 0.06 : 1
      const base = isActive ? 0.82 : 0.62
      const next = THREE.MathUtils.lerp(mesh.scale.x, base * pulse, settle)
      mesh.scale.setScalar(next)
      if (!reduced)
        mesh.rotation.y = isActive ? time * 0.8 : THREE.MathUtils.lerp(mesh.rotation.y, 0, settle)
    })

    const targetX = allDone ? nodeX(PIPELINE_NODES.length - 1) : progressX(progress)
    fillX.current = THREE.MathUtils.lerp(fillX.current, targetX, settle)
    const fillLength = Math.max(0.0001, fillX.current - X0)
    const fill = fillRef.current
    if (fill) {
      // The fill lives in a group rotated -90deg about z, so its local +y axis points along world +x.
      fill.scale.set(1.6, fillLength, 1.6)
      fill.position.set(0, X0 + fillLength / 2, 0)
      resources.fillMaterial.color.copy(
        status === 'error' ? colors.bad : allDone ? colors.good : colors.accent,
      )
      resources.fillMaterial.emissive.copy(resources.fillMaterial.color)
    }

    const particles = particlesRef.current
    if (particles) {
      const running = status === 'running' && !reduced
      for (let i = 0; i < PARTICLES; i += 1) {
        const u = (time * 0.35 + i / PARTICLES) % 1
        const x = X0 + u * fillLength
        const y = Math.sin(time * 3 + i) * 0.05
        const scale = running ? Math.sin(u * Math.PI) : 0.0001
        scratch.matrix.makeScale(scale, scale, scale).setPosition(x, y, 0)
        particles.setMatrixAt(i, scratch.matrix)
      }
      particles.instanceMatrix.needsUpdate = true
    }

    const group = groupRef.current
    if (group && !reduced) {
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0.28 - state.pointer.y * 0.08, 0.05)
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, state.pointer.x * 0.12, 0.05)
    }
  })

  return (
    <>
      <hemisphereLight args={['#ffffff', colors.bg, 0.9]} />
      <directionalLight position={[4, 6, 6]} intensity={1.6} />
      <group ref={groupRef} rotation={[0.28, 0, 0]}>
        <mesh
          geometry={resources.track}
          material={resources.trackMaterial}
          rotation={[0, 0, Math.PI / 2]}
          scale={[1, -X0 * 2, 1]}
        />
        <group rotation={[0, 0, -Math.PI / 2]}>
          <mesh
            ref={fillRef}
            geometry={resources.track}
            material={resources.fillMaterial}
            scale={[1.6, 0.0001, 1.6]}
          />
        </group>
        <instancedMesh
          ref={particlesRef}
          args={[resources.particle, resources.particleMaterial, PARTICLES]}
          frustumCulled={false}
        />
        {PIPELINE_NODES.map((node, index) => (
          <mesh
            key={node.step}
            ref={(element) => {
              nodeRefs.current[index] = element
            }}
            geometry={resources.node}
            material={resources.nodeMaterials[index]}
            position={[nodeX(index), 0, 0]}
            scale={0.62}
          />
        ))}
      </group>
    </>
  )
}
