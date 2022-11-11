import { useEffect } from 'react'
import { Bone, Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader'

const bodyParts = [
  './models/custom/Cha-Custom-Base-Arm.glb',
  './models/custom/Cha-Custom-Base-Hair.glb',
  './models/custom/Cha-Custom-Base-Head.glb',
  './models/custom/Cha-Custom-Base-Leg.glb',
  './models/custom/Cha-Custom-Base-Shoes.glb',
  './models/custom/Cha-Custom-Base-Top.glb',
  './models/custom/Cha-Custom-Base-Bottom.glb'
  // './models/custom/Cha-Custom-Bottom-2.glb',
  // './models/custom/Cha-Custom-Top-2.glb',
  // './models/custom/Cha-Custom-Base.glb'
]

const animations = {
  // Idle: '/animations/idle.glb',
  // Walking: '/animations/walk.glb',
  // WalkingBackwards: '/animations/walkBack.glb',
  // LeftStrafeWalk: '/animations/walkLeft.glb',
  // RightStrafeWalk: '/animations/walkRight.glb',
  // Running: '/animations/run.glb',
  // RunningBackward: '/animations/runBack.glb',
  // LeftStrafe: '/animations/runLeft.glb',
  // RightStrafe: '/animations/runRight.glb',
  // Flying: '/animations/fly.glb'
  HipHopDancing: './animations/custom/HipHopDancing.glb',
  JoyfulJump: './animations/custom/JoyfulJump'
}

const gltfName = 'Avatar'

export default function App (): JSX.Element {
  useEffect(() => {
    combineAnimations().catch(console.error)
  }, [])

  return (
    <div>loading</div>
  )
}

async function combineAnimations (): Promise<void> {
  const gltfLoader = new GLTFLoader()
  const gltfExporter = new GLTFExporter()
  const group = new Group()

  group.name = gltfName

  await Promise.all(bodyParts.map(async (path) => {
    const gltf = await asyncGltfLoad(gltfLoader, path)
    group.add(gltf.scene)
  }))
  // console.log(group.traverse(function (child) {
  //   console.log(child)
  // }))

  await loadAnimations(group, animations)

  gltfExporter.parse(
    group,
    (glb) => download(glb as ArrayBuffer, 'test.glb'),
    console.error,
    { binary: true, animations: group.animations }
  )
}

async function loadAnimations (group: Group, animations: Object): Promise<void> {
  const gltfLoader = new GLTFLoader()

  for (const [name, path] of Object.entries(animations)) {
    const gltf = await asyncGltfLoad(gltfLoader, path)

    gltf.animations[0].name = name
    group.animations.push(gltf.animations[0])
  }
}

function download (arrayBuffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
}

async function asyncGltfLoad (gltfLoader: GLTFLoader, path: string): Promise<GLTF> {
  return await new Promise((resolve, reject) => {
    gltfLoader.load(path, resolve, undefined, reject)
  })
}
