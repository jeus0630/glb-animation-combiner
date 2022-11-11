import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter'

function hasHubsComponent (mesh, componentName) {
  return !!findChild({
    candidates: [mesh],
    predicate: (obj) => {
      const gltfExtensions = obj.userData.gltfExtensions
      const hubsComponents = gltfExtensions && gltfExtensions.MOZ_hubs_components
      if (hubsComponents && hubsComponents[componentName]) {
        return true
      }
    }
  })
}

function bakeMorphs (mesh) {
  const bakedMorphIndices = new Set()
  if (!mesh.morphTargetInfluences) return bakedMorphIndices
  if (!mesh.geometry.morphTargetsRelative) return bakedMorphIndices

  const morphAttributes = mesh.geometry.morphAttributes

  Object.entries(morphAttributes).forEach(([propertyName, buffers]) => {
    buffers.forEach((morphBufferAttribute, index) => {
      const weight = mesh.morphTargetInfluences[index]
      if (weight > 0) {
        bakedMorphIndices.add(index)
        addIn({
          bakedAttribute: mesh.geometry.attributes[propertyName],
          morphAttribute: morphBufferAttribute,
          weight
        })
      }
    })
  })

  return bakedMorphIndices
}

function removeBakedMorphs (mesh, bakedMorphIndices) {
  bakedMorphIndices.forEach((morphIndex) => {
    delete mesh.geometry.morphAttributes[morphIndex]
    mesh.morphTargetInfluences.splice(morphIndex, 1)

    const [morphName, _morphIndex] = Object.entries(mesh.morphTargetDictionary).find(
      ([morphName, index]) => index === morphIndex
    )
    delete mesh.morphTargetDictionary[morphName]
  })
}

function lerp (t, min, max, newMin, newMax) {
  const progress = (t - min) / (max - min)
  return newMin + progress * (newMax - newMin)
}

function remapUVs ({ mesh, uvs }) {
  // TODO: Should we mutate the existing geometry instead?
  // What is the appropriate contract between this function and
  // its calling context?
  const geometry = mesh.geometry.clone()
  mesh.geometry = geometry

  const { min, max } = uvs
  const uv = geometry.attributes.uv
  if (uv) {
    for (let i = 0; i < uv.array.length; i += 2) {
      uv.array[i] = lerp(uv.array[i], 0, 1, min.x, max.x)
      uv.array[i + 1] = lerp(uv.array[i + 1], 0, 1, min.y, max.y)
    }
  }
  const uv2 = geometry.attributes.uv2
  if (uv2) {
    for (let i = 0; i < uv2.array.length; i += 2) {
      uv2.array[i] = lerp(uv2.array[i], 0, 1, min.x, max.x)
      uv2.array[i + 1] = lerp(uv2.array[i + 1], 0, 1, min.y, max.y)
    }
  }
}

async function combine ({ avatar }) {
  const meshesToExclude = findChildrenByType(avatar, 'SkinnedMesh').filter(
    (mesh) => mesh.material.transparent || hasHubsComponent(mesh, 'uv-scroll')
  )

  const meshes = findChildrenByType(avatar, 'SkinnedMesh').filter((mesh) => !meshesToExclude.includes(mesh))

  const { textures, uvs } = await createTextureAtlas({ meshes })
  meshes.forEach((mesh) => remapUVs({ mesh, uvs: uvs.get(mesh) }))

  meshes.forEach((mesh) => removeBakedMorphs(mesh, bakeMorphs(mesh)))

  meshes.forEach((mesh) => {
    const geometry = mesh.geometry
    if (!geometry.attributes.uv2) {
      geometry.attributes.uv2 = geometry.attributes.uv
    }
    // Exlude the currently "activated" morph attributes before merging.
    // The BufferAttributes are not lost; they remain in `mesh.geometry.morphAttributes`
    // and the influences remain in `mesh.morphTargetInfluences`.
    for (let i = 0; i < 8; i++) {
      delete geometry.attributes[`morphTarget${i}`]
      delete geometry.attributes[`morphNormal${i}`]
    }
  })

  const { source, dest } = mergeGeometry({ meshes })

  const geometry = new THREE.BufferGeometry()
  geometry.attributes = dest.attributes
  geometry.morphAttributes = dest.morphAttributes
  geometry.morphTargetsRelative = true
  geometry.setIndex(dest.index)

  const material = new THREE.MeshStandardMaterial({
    map: textures.diffuse,
    normalMap: textures.normal,
    aoMap: textures.orm,
    roughnessMap: textures.orm,
    metalnessMap: textures.orm
  })
  material.metalness = 1

  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.name = constants.combinedMeshName
  mesh.morphTargetInfluences = dest.morphTargetInfluences
  mesh.morphTargetDictionary = dest.morphTargetDictionary

  if ('MouthFlap' in mesh.morphTargetDictionary) {
    mesh.userData = {
      gltfExtensions: {
        MOZ_hubs_components: {
          'morph-audio-feedback': {
            minValue: 0,
            maxValue: 1,
            name: 'MouthFlap'
          }
        }
      }
    }
  }

  // Add unmerged meshes
  const clones = meshesToExclude.map((o) => {
    return o.clone(false)
  })

  const skeleton = cloneSkeleton(meshes[0])
  mesh.bind(skeleton)
  clones.forEach((clone) => {
    clone.bind(skeleton)
  })

  const group = new THREE.Object3D()
  group.name = 'AvatarRoot'
  group.animations = dest.animations
  group.add(mesh)
  group.add(skeleton.bones[0])
  clones.forEach((clone) => {
    group.add(clone)
  })

  group.userData = {
    gltfExtensions: {
      MOZ_hubs_components: {
        'loop-animation': {
          clip: 'idle_eyes,Blinks',
          paused: false
        }
      }
    }
  }
  return group
}

function findChildren ({ candidates, predicate, results = [] }) {
  if (!candidates.length) {
    return results
  }

  const candidate = candidates.shift()
  if (predicate(candidate)) {
    results.push(candidate)
  }

  candidates = candidates.concat(candidate.children)
  return findChildren({ candidates, predicate, results })
}

function findChild ({ candidates, predicate }) {
  if (!candidates.length) {
    return null
  }

  const candidate = candidates.shift()
  if (predicate(candidate)) return candidate

  candidates = candidates.concat(candidate.children)
  return findChild({ candidates, predicate })
}

function findChildByName (root, name) {
  return findChild({
    candidates: [root],
    predicate: (o) => o.name === name
  })
}

function findChildrenByType (root, type) {
  return findChildren({
    candidates: [root],
    predicate: (o) => o.type === type
  })
}

function cloneSkeleton (skinnedMesh): void {
  skinnedMesh.skeleton.pose()

  const boneClones = new Map()

  for (const bone of skinnedMesh.skeleton.bones) {
    const clone = bone.clone(false)
    boneClones.set(bone, clone)
  }

  // Preserve original bone structure
  // Assume bones[0] is root bone
  skinnedMesh.skeleton.bones[0].traverse((o: any) => {
    if (o.type !== 'Bone') return
    const clone = boneClones.get(o)
    for (const child of o.children) {
      clone.add(boneClones.get(child))
    }
  })

  return new THREE.Skeleton(skinnedMesh.skeleton.bones.map((b) => boneClones.get(b)))
}

function ensureHubsComponents (userData) {
  if (!userData.gltfExtensions) {
    userData.gltfExtensions = {}
  }
  if (!userData.gltfExtensions.MOZ_hubs_components) {
    userData.gltfExtensions.MOZ_hubs_components = {}
  }
  return userData
}

export function combineHubsComponents (a, b) {
  ensureHubsComponents(a)
  ensureHubsComponents(b)
  if (a.gltfExtensions.MOZ_hubs_components)
  // TODO: Deep merge
  {
    a.gltfExtensions.MOZ_hubs_components = Object.assign(
      a.gltfExtensions.MOZ_hubs_components,
      b.gltfExtensions.MOZ_hubs_components
    )
  }

  return a
}

export const exportGLTF = (function () {
  const exporter = new GLTFExporter()
  return async function exportGLTF (object3D, { binary, animations }) {
    return await new Promise((resolve) => {
      exporter.parse(object3D, (gltf) => resolve({ gltf }), { binary, animations })
    })
  }
})()

function addNonDuplicateAnimationClips (clone, scene) {
  const clipsToAdd = []

  for (const clip of scene.animations) {
    const index = clone.animations.findIndex((clonedAnimation) => {
      return clonedAnimation.name === clip.name
    })
    if (index === -1) {
      clipsToAdd.push(clip)
    }
  }

  for (const clip of clipsToAdd) {
    clone.animations.push(clip)
  }
}

function cloneIntoAvatar (avatarGroup) {
  const clonedScene = new THREE.Group()
  clonedScene.name = 'Scene'

  // Combine the root "Scene" nodes
  const scenes = avatarGroup.children
    .map((o) => {
      return findChildByName(o, 'Scene')
    })
    .filter((o) => !!o)
  for (const scene of scenes) {
    addNonDuplicateAnimationClips(clonedScene, scene)
  }

  // Combine the "AvatarRoot" nodes
  const avatarRoots = avatarGroup.children
    .map((o) => {
      return findChildByName(o, 'AvatarRoot')
    })
    .filter((o) => !!o)
  const clonedAvatarRoot = avatarRoots[0].clone(false)
  for (const avatarRoot of avatarRoots) {
    clonedAvatarRoot.userData = combineHubsComponents(clonedAvatarRoot.userData, avatarRoot.userData)
  }

  // Clone skinned meshes, bind them to a new skeleton
  const clonedSkinnedMeshes = findChildrenByType(avatarGroup, 'SkinnedMesh').map((o) => {
    return o.clone(false)
  })
  const clonedSkeleton = cloneSkeleton(clonedSkinnedMeshes[0])
  for (const skinnedMesh of clonedSkinnedMeshes) {
    skinnedMesh.bind(clonedSkeleton)
  }

  // Combine clones
  clonedScene.add(clonedAvatarRoot)
  clonedAvatarRoot.add(clonedSkeleton.bones[0]) // Assume bones[0] is root bone
  for (const skinnedMesh of clonedSkinnedMeshes) {
    clonedAvatarRoot.add(skinnedMesh)
  }
  return clonedScene
}
async function exportAvatar (avatarGroup) {
  // TODO: Re-evaluate whether we want to perform this step.
  // The intention (for now) is to make combination optional,
  // so that it is easy to debug and also if non-mergable meshes
  // are added, there's a workaround for them.
  const clone = cloneIntoAvatar(avatarGroup)

  const avatar = await combine({ avatar: clone })

  const { gltf: glb } = await exportGLTF(avatar, { binary: true, animations: avatar.animations })
  return { glb }
}
