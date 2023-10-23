import * as THREE from "three";
// import functionalities
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton";
// import shaders
import vertexShader from "../shaders/vertex.glsl";
import fragmentShader from "../shaders/fragment.glsl";
import { convertArray } from "three/src/animation/AnimationUtils";
import * as dat from 'dat.gui';

// parameters
const fileReader = new FileReader();
let fileInput = document.getElementById("fileInput"); // load file after input using the html button
let file2Buff = new pixpipe.FileToArrayBufferReader();
let gui = new dat.GUI();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let controls = {};
let orbit = {};
let guiParam = {};
let spaceLength = new THREE.Vector3();
let spaceStep = new THREE.Vector3();
let renderer = null;
let scene = null;
let camera = null;
let shaderMat = null;
let boxHelper = null;
let container = new THREE.Object3D();
let screenContainer = new THREE.Object3D();
let meshContainer = new THREE.Object3D();
let hitTestSource = null;
let hitTestSourceRequested = false;
let controllerXR;
let containerVisible = false;
let volumes = [];
let sliceMatrixSize = {};
let textures = [];
let mniVolumeMetadata = { xspace: null, yspace: null, zspace: null };
let clipPlaneDirections = [1, 1, 1];
let clipPlanes = [
  new THREE.Plane(new THREE.Vector3(0, 0, 0), 0),
  new THREE.Plane(new THREE.Vector3(0, 0, 0), 0),
  new THREE.Plane(new THREE.Vector3(0, 0, 0), 0),
];
let overlayContent = document.getElementById("overlay-content");
let inputScale = document.getElementById("range-scale");
let clipOptions = document.getElementById("clip-options");
let rangeClip = document.getElementById("range-clip");


let reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xffffff * Math.random() })
);
reticle.visible = false;
reticle.matrixAutoUpdate = false;


// the image is loaded...
file2Buff.on("ready", function () {
  console.log("file2Buff: ", this);
  let filenames = this.getMetadata("filenames"); // the name of the file loaded ex T1.nii
  let volBuff = this.getOutput(); // the volume data in the form of an ArrayBuffer, witch means raw-binary data

  // trying to decode the file
  let genericDecoder = new pixpipe.Image3DGenericDecoder();
  genericDecoder.addInput(volBuff); // addd the raw binary data of the volume
  genericDecoder.update(); // the decoder trying to decode the file

  // if nothing was decoded, we exit
  if (!genericDecoder.getNumberOfOutputs()) {
    document.getElementById("fileInfo").innerHTML =
      "Error. This file can not be decoded :(";
    return;
  }

  let mniVolume = genericDecoder.getOutput(); // a pixpipe object Image3D that holds the volume data
  console.log("mniVolume: ", mniVolume);

  if (mniVolume) {
    volumes.push(mniVolume);

    let mosaicFilter = new pixpipe.Image3DToMosaicFilter();

    // this function takes the Image3D and
    // outputs multiple Image2D
    // slices in a specified orthogonal direction x,y,z
    let space = "zspace"; // the axis that we want the slices to be taken
    mosaicFilter.addInput(mniVolume);
    mosaicFilter.setMetadata("axis", space);
    mosaicFilter.update();
    console.log("mosaicFilter: ", mosaicFilter);

    if (!mosaicFilter.getNumberOfOutputs()) {
      console.log("No output for mosaicFilter.");
      document.getElementById("fileInfo").innerHTML = "Error.";
      return;
    } else {
      // get information about the slices found along the specified axis
      // along with the pixel dimentions of the slices
      let spaceInfo = mniVolume.getMetadata(space);
      document.getElementById("fileInfo").textContent =
        filenames[0] +
        " is composed of " +
        spaceInfo.space_length +
        " slices of size " +
        spaceInfo.width +
        "x" +
        spaceInfo.height +
        "px";
    }

    // mosaic filter creates multiple outputs that are Image2D. Each Image2D
    // is a collection of the slices combined like a montage. In we have multiple
    // slices we might have also multiple outputs Image2Ds.
    for (var nbOut = 0; nbOut < mosaicFilter.getNumberOfOutputs(); nbOut++) {
      // an Image2D that is a combination of multiple slices
      // sets the min and max values of the voxels inside each Image2D
      // to be the global min max of the voxels
      let outputMosaic = mosaicFilter.getOutput(nbOut);
      outputMosaic.setMetadata("min", mniVolume.getMetadata("voxel_min"));
      outputMosaic.setMetadata("max", mniVolume.getMetadata("voxel_max"));

      //var data = outputMosaic.getData();
      let data = outputMosaic.getDataAsUInt8Array(); // this function was problematic and was corrected. It did not normalize properly
      let texture = new THREE.DataTexture(
        data,
        outputMosaic.getWidth(),
        outputMosaic.getHeight(),
        THREE.LuminanceFormat,
        THREE.UnsignedByteType
      );
      texture.needsUpdate = true;
      textures.push(texture);
    }

    // the number of combined slices  horizontaly and vertically inside each Image2D
    sliceMatrixSize.x = mosaicFilter.getMetadata("gridWidth");
    sliceMatrixSize.y = mosaicFilter.getMetadata("gridHeight");

    // the size of the voxels in the mni volumn in each direction
    spaceStep.x = Math.abs(mniVolume.getMetadata("xspace").step);
    spaceStep.y = Math.abs(mniVolume.getMetadata("yspace").step);
    spaceStep.z = Math.abs(mniVolume.getMetadata("zspace").step);

    // the size in mm of the mni volumn in each direction
    spaceLength.x = spaceStep.x * mniVolume.getMetadata("xspace").space_length;
    spaceLength.y = spaceStep.y * mniVolume.getMetadata("yspace").space_length;
    spaceLength.z = spaceStep.z * mniVolume.getMetadata("zspace").space_length;

    mniVolumeMetadata.xspace = mniVolume.getMetadata("xspace");
    mniVolumeMetadata.yspace = mniVolume.getMetadata("yspace");
    mniVolumeMetadata.zspace = mniVolume.getMetadata("zspace");

    // since the volume is loaded, we can create the 3D env
    initEnv3D();
  } else {
    console.warn("Non-existant output for genericDecoder.");
  }
});


// event listener of the file input
fileInput.addEventListener("change", function (e) {
  let files = e.target.files;
  let filenames = {};

  for (var i = 0; i < files.length; i++) {
    // set the input, an HTML5 File object and a category (ID)
    file2Buff.addInput(files[i], i);
    filenames[i] = files[i].name;
  }

  file2Buff.setMetadata("filenames", filenames);
  document.getElementById("fileOpener").style.display = "none";
  document.getElementById("fileInfo").textContent =
    "Decoding volume file file and building 3D texture...";

  // Perform the reading + conversion ibto ArrayBuffer
  file2Buff.update();
});

// event listener of the file input
fileInputSurface.addEventListener("change", function (e) {
  if (!e.target.files.length) {
    console.warn("No file was selected.");
    return;
  }
  let file = e.target.files[0];
  let mesh;

  if (file) {
    const loader = new GLTFLoader();
    loader.load("../data/" + file.name, (glb) => {
      mesh = glb.scene;

      // enable the mesh to be cliped
      mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // visual material properties
          child.material.transparent = true;
          child.material.opacity = guiParam.alphaMesh;
          child.material.side = THREE.DoubleSide;

          // for proper interaction with the mni planes
          child.renderOrder = 10;
          child.material.depthWrite = true;
          child.material.depthTest = true;

          // clipping parameters
          child.material.clippingPlanes = clipPlanes;
          child.material.clipIntersection = true;
          child.material.clipShadows = true;

          meshContainer.add(child);
        }
      });

      updateClipPlane();
      render();
    });
  }
});

// initialize the 3D environment
function initEnv3D() {
  console.log("initEnv3D...");

  // init renderer
  renderer = new THREE.WebGL1Renderer({ antialias: true, alpha: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  //   renderer.setClearColor(0xeeeeee, 1);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  const buttonAR = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlayContent },
  });
  document.body.appendChild(buttonAR);

  // THREE environment
  scene = new THREE.Scene();

  // axis helper
  let axisHelper = new THREE.AxesHelper(100);
  axisHelper.renderOrder = 5;
  scene.add(axisHelper);

  // camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    1,
    1000
  );
  camera.position.z = 100;

  // light
  scene.add(new THREE.AmbientLight(0x444444));
  var light = new THREE.DirectionalLight(0xffffff, 150);
  light.position.set(100, 100, 100);
  camera.add(light);
  scene.add(camera);

  scene.add(reticle);
  controllerXR = renderer.xr.getController(0);
  controllerXR.addEventListener("select", () => {
    containerVisible = true;
    if (reticle.visible) {
      container.scale.set(0.001,0.001,0.001)
      container.position.setFromMatrixPosition(reticle.matrix);
      

      // space.position.set(0,0,-1).applyMatrix4( controllerXR.matrixWorld );
      // space.quaternion.setFromRotationMatrix( controllerXR.matrixWorld );
      scene.add(container);
    }
  });
  scene.add(controllerXR);

  // container
  scene.add(container);

  // orbit
  orbit = new OrbitControls(camera, renderer.domElement);

  // controls
  controls = new TransformControls(camera, renderer.domElement);
  controls.attach(container);
  controls.addEventListener("dragging-changed", function (event) {
    orbit.enabled = !event.value;
  });
  scene.add(controls);

  // mesh
  meshContainer.scale.set(-1000, -1000, -1000);
  meshContainer.position.x = spaceLength.x / 2;
  meshContainer.position.y = spaceLength.y / 2;
  meshContainer.position.z = spaceLength.z / 2;
  container.add(meshContainer);

  initGui();
  initBox();
  initScreen();
  render();

  document.getElementById("surfaceOpener").style.display = "inherit";
}

// the GUI widget on the top right
function initGui() {
  gui.width = 400;

  let planeFolder = gui.addFolder("Plane Settings");

  guiParam.xPos = spaceLength.x/2;
  let o = planeFolder
    .add(guiParam, "xPos",0, spaceLength.x)
    .step(0.05)
    .onChange(function (val) {
      screenContainer.position.x = val - spaceLength.x/2;
      updateClipPlane();
    })
    .listen();

  console.log(o);

  guiParam.yPos = spaceLength.y / 2;
  planeFolder
    .add(guiParam, "yPos", 0, spaceLength.y)
    .step(0.05)
    .onChange(function (val) {
      screenContainer.position.y = val - spaceLength.y / 2;
      updateClipPlane();
    })
    .listen();

  guiParam.zPos = spaceLength.z / 2;
  planeFolder
    .add(guiParam, "zPos", 0, spaceLength.z)
    .step(0.05)
    .onChange(function (val) {
      screenContainer.position.z = val - spaceLength.z / 2;
      updateClipPlane();
    })
    .listen();

  guiParam.xRot = 0;
  planeFolder
    .add(guiParam, "xRot", -Math.PI / 2, Math.PI / 2)
    .step(Math.PI / 2 / 500)
    .onChange(function (val) {
      screenContainer.rotation.x = val;
      updateClipPlane();
    })
    .listen();

  guiParam.yRot = 0;
  planeFolder
    .add(guiParam, "yRot", -Math.PI / 2, Math.PI / 2)
    .step(Math.PI / 2 / 500)
    .onChange(function (val) {
      screenContainer.rotation.y = val;
      updateClipPlane();
    })
    .listen();

  guiParam.zRot = 0;
  planeFolder
    .add(guiParam, "zRot", -Math.PI / 2, Math.PI / 2)
    .step(Math.PI / 2 / 500)
    .onChange(function (val) {
      screenContainer.rotation.z = val;
      updateClipPlane();
    })
    .listen();

  guiParam.showPlane1 = true;
  planeFolder
    .add(guiParam, "showPlane1")
    .name("Show plane A")
    .onChange(function (val) {
      screenContainer.children[0].visible = val;
    });

  guiParam.showPlane2 = true;
  planeFolder
    .add(guiParam, "showPlane2")
    .name("Show plane S")
    .onChange(function (val) {
      screenContainer.children[1].visible = val;
    });

  guiParam.showPlane3 = true;
  planeFolder
    .add(guiParam, "showPlane3")
    .name("Show plane C")
    .onChange(function (val) {
      screenContainer.children[2].visible = val;
    });

  guiParam.centerPosition = function () {
    guiParam.xPos = Math.floor(spaceLength.x / 2);
    guiParam.yPos = Math.floor(spaceLength.y / 2);
    guiParam.zPos = Math.floor(spaceLength.z / 2);
    screenContainer.position.x = guiParam.xPos - spaceLength.x / 2;
    screenContainer.position.y = guiParam.yPos - spaceLength.y / 2;
    screenContainer.position.z = guiParam.zPos - spaceLength.z / 2;
    updateClipPlane();
  };
  planeFolder.add(guiParam, "centerPosition").name("Center position");

  guiParam.resetRotation = function () {
    guiParam.xRot = 0;
    guiParam.yRot = 0;
    guiParam.zRot = 0;
    screenContainer.rotation.x = 0;
    screenContainer.rotation.y = 0;
    screenContainer.rotation.z = 0;
    updateClipPlane();
  };
  planeFolder.add(guiParam, "resetRotation").name("Reset rotation");

  guiParam.alpha = 0.95;
  planeFolder
    .add(guiParam, "alpha", 0, 1)
    .step(0.01)
    .onChange(function (val) {
      shaderMat.uniforms.forcedAlpha.value = val;
    });

  guiParam.triliInterpol = true;
  planeFolder
    .add(guiParam, "triliInterpol")
    .name("Interpolate")
    .onChange(function (val) {
      shaderMat.uniforms.trilinearInterpol.value = val;
    });

  //******************************* mesh ***************
  let meshFolder = gui.addFolder("Mesh Settings");

  guiParam.alphaMesh = 0.6;
  meshFolder
    .add(guiParam, "alphaMesh", 0, 1)
    .step(0.01)
    .onChange(function (val) {
      for (var i = 0; i < meshContainer.children.length; i++) {
        meshContainer.children[i].material.opacity = val;
      }
      if (val < 0.05) {
        meshContainer.visible = false;
      } else {
        meshContainer.visible = true;
      }
    });

  guiParam.autoHideOctant = true;
  meshFolder
    .add(guiParam, "autoHideOctant")
    .name("Hide octant")
    .onChange(function (val) {
      renderer.localClippingEnabled = val;
    });

}


// screens are the planes on which are projected the images.
// Here, we create a their custom materials and all

function initScreen() {
  let uniforms = {
    containerMat: { type: "mat4", value: container.matrix.clone().invert() },
    spaceLength: { type: "vec3", value: spaceLength },
    spaceStep: { type: "vec3", value: spaceStep },
    nbOfTextureUsed: { type: "i", value: textures.length },
    nbSlicePerRow: { type: "f", value: sliceMatrixSize.x },
    nbSlicePerCol: { type: "f", value: sliceMatrixSize.y },
    nbSliceTotal: { type: "f", value: mniVolumeMetadata.zspace.space_length },
    forcedAlpha: { type: "f", value: guiParam.alpha },
    textures: { type: "t", value: textures },
    trilinearInterpol: { type: "b", value: guiParam.triliInterpol },
  };

  shaderMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
  });

  // the largest side is computed in order for the rotations of the planes to render the nifti properly
  let largestSide =
    Math.sqrt(
      spaceLength.x * spaceLength.x +
        spaceLength.y * spaceLength.y +
        spaceLength.z * spaceLength.z
    ) * 2;
  let xPlaneGeometry = new THREE.PlaneGeometry(largestSide, largestSide, 1);
  let yPlaneGeometry = new THREE.PlaneGeometry(largestSide, largestSide, 1);
  let zPlaneGeometry = new THREE.PlaneGeometry(largestSide, largestSide, 1);

  let xPlaneMesh = new THREE.Mesh(xPlaneGeometry, shaderMat);
  let yPlaneMesh = new THREE.Mesh(yPlaneGeometry, shaderMat);
  let zPlaneMesh = new THREE.Mesh(zPlaneGeometry, shaderMat);

  xPlaneMesh.rotation.y = Math.PI / 2;
  yPlaneMesh.rotation.x = Math.PI / 2;

  xPlaneMesh.renderOrder = 0;
  yPlaneMesh.renderOrder = 1;
  zPlaneMesh.renderOrder = 2;

  screenContainer.add(xPlaneMesh);
  screenContainer.add(yPlaneMesh);
  screenContainer.add(zPlaneMesh);

  screenContainer.traverse((plane) => {
    if (plane instanceof THREE.Mesh) {
      plane.material.transparent = true;
      plane.material.depthWrite = true;
      plane.material.depthTest = true;
    }
  });

  screenContainer.position.x = guiParam.xPos - spaceLength.x / 2;
  screenContainer.position.y = guiParam.yPos - spaceLength.y / 2;
  screenContainer.position.z = guiParam.zPos - spaceLength.z / 2;

  screenContainer.rotation.x = guiParam.xRot;
  screenContainer.rotation.y = guiParam.yRot;
  screenContainer.rotation.z = guiParam.zRot;

  container.add(screenContainer);
  updateClipPlane();
}

// creates a red wireframe bouting box around the 3D planes
function initBox() {
  let boxMaterial = new THREE.MeshBasicMaterial();
  let boxGeom = new THREE.BoxGeometry(
    spaceLength.x,
    spaceLength.y,
    spaceLength.z
  );

  let boxMesh = new THREE.Mesh(boxGeom, boxMaterial);
  boxHelper = new THREE.BoxHelper(boxMesh, 0xff9999);
  boxHelper.geometry.computeBoundingBox();
  container.add(boxHelper);

  // adjust the camera to the box
  camera.position.z = -spaceLength.z;
  camera.position.y = (spaceLength.y * 2) / 3;
  camera.position.x = (spaceLength.x * 2) / 3;
  camera.lookAt(new THREE.Vector3(0, 0, 0));
}


clipOptions.addEventListener("change", (e) => {
  if (clipOptions.value == "x") {
    rangeClip.value = screenContainer.position.x;
  }
  if (clipOptions.value == "y") {
    rangeClip.value = screenContainer.position.y;

  }
  if (clipOptions.value == "z") {
    rangeClip.value = screenContainer.position.z;
  }
});

rangeClip.addEventListener("input", (e) => {
  if (clipOptions.value == "x") {
    rangeClip.max=spaceLength.x/2
    rangeClip.min=-spaceLength.x/2
    screenContainer.position.x = rangeClip.value;


  }
  if (clipOptions.value == "y") {
    rangeClip.max=spaceLength.y/2
    rangeClip.min=-spaceLength.y/2
    screenContainer.position.y = rangeClip.value;
  }
  if (clipOptions.value == "z") {
    rangeClip.max=spaceLength.z/2
    rangeClip.min=-spaceLength.z/2
    screenContainer.position.z = rangeClip.value;
    console.log("RangeClip",rangeClip.value)

  }
});
inputScale.addEventListener("input", (e) => {
  let scale = inputScale.value;
  container.scale.set(scale, scale, scale);
});

// called max 60 times per sec
function render(timestamp, frame) {
  if (renderer.xr.isPresenting) {
    container.visible=containerVisible
    container.rotation.y+=0.005
    updateClipPlane()
    document.getElementById("clip-options").style.visibility = "visible";
    document.getElementById("range-scale").style.visibility = "visible";
    document.getElementById("range-clip").style.visibility = "visible";
    document.getElementById("label-scale").style.visibility = "visible";
    scene.remove(controls);

  }else{
    container.visible=true
  }
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace("viewer").then((referenceSpace) => {
        session
          .requestHitTestSource({ space: referenceSpace })
          .then((source) => (hitTestSource = source));
      });

      hitTestSourceRequested = true;
      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  // update uniforms when container is moved
  shaderMat.uniforms.containerMat.value = container.matrix.clone().invert();
  raycastPlaneContainer();
  determineClosestOctant();
  renderer.render(scene, camera);
  renderer.setAnimationLoop(render);
}

function onMouseMove(event) {
  // calculate mouse position in normalized device coordinates
  // (-1 to +1) for both components
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function updateClipPlane() {
  screenContainer.updateMatrixWorld();
  screenContainer.updateMatrix();

  screenContainer.children.forEach(function (screen, index) {
    screen.updateMatrixWorld();
    screen.updateMatrix();
  });

  clipPlanes[0].setFromNormalAndCoplanarPoint(
    new THREE.Vector3(clipPlaneDirections[0], 0, 0).applyQuaternion(
      screenContainer.quaternion
    ), // a normal
    screenContainer.position.clone() // a point from the plane
  );

  clipPlanes[1].setFromNormalAndCoplanarPoint(
    new THREE.Vector3(0, clipPlaneDirections[1], 0).applyQuaternion(
      screenContainer.quaternion
    ), // a normal
    screenContainer.position.clone() // a point from the plane
  );

  clipPlanes[2].setFromNormalAndCoplanarPoint(
    new THREE.Vector3(0, 0, clipPlaneDirections[2]).applyQuaternion(
      screenContainer.quaternion
    ), // a normal
    screenContainer.position.clone() // a point from the plane
  );
}

function determineClosestOctant() {
  let octant = clipPlanes.map((plane) => {
    const orientation = camera.position.dot(plane.normal);
    return Math.sign(orientation);
  });

  if (!octant.every((value) => value < 0)) {
    clipPlaneDirections = octant.map(
      (sign, index) => -sign * clipPlaneDirections[index]
    );
    updateClipPlane();
  }
}

function raycastPlaneContainer() {
  if (!screenContainer || !boxHelper.geometry.boundingBox) return;

  raycaster.setFromCamera(mouse, camera);

  // calculate objects intersecting the picking ray
  let intersects = raycaster.intersectObject(screenContainer, true);

  let validIntersect = null;

  for (var i = 0; i < intersects.length; i++) {
    if (boxHelper.geometry.boundingBox.containsPoint(intersects[i].point)) {
      validIntersect = intersects[i];
      break;
    }
  }

  if (validIntersect) {
    let positionInVolume = {
      x: Math.round((validIntersect.point.x + spaceLength.x / 2) / spaceStep.x),
      y: Math.round((validIntersect.point.y + spaceLength.y / 2) / spaceStep.y),
      z: Math.round((validIntersect.point.z + spaceLength.z / 2) / spaceStep.z),
    };

    let intensity = volumes[0].getPixel(positionInVolume);
  }
}

// to refresh the aspect ratio when the windows is resized
window.addEventListener(
  "resize",
  function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  },
  false
);

window.addEventListener("keydown", function (event) {
  switch (event.keyCode) {
    case 81: // Q
      controls.setSpace(controls.space === "local" ? "world" : "local");
      break;

    case 16: // Shift
      controls.setTranslationSnap(100);
      controls.setRotationSnap(THREE.MathUtils.degToRad(15));
      controls.setScaleSnap(0.25);
      break;

    case 87: // W
      controls.setMode("translate");
      break;

    case 69: // E
      controls.setMode("rotate");
      break;

    case 82: // R
      controls.setMode("scale");
      break;

    case 187:
    case 107: // +, =, num+
      controls.setSize(controls.size + 0.1);
      break;

    case 189:
    case 109: // -, _, num-
      controls.setSize(Math.max(controls.size - 0.1, 0.1));
      break;

    case 68: // D
      controls.enabled = !controls.enabled;
      controls.showX = !controls.showX;
      controls.showY = !controls.showY;
      controls.showZ = !controls.showZ;
      break;

    case 27: // Esc
      controls.reset();
      break;
  }
});

window.addEventListener("keyup", function (event) {
  switch (event.keyCode) {
    case 16: // Shift
      controls.setTranslationSnap(null);
      controls.setRotationSnap(null);
      controls.setScaleSnap(null);
      break;
  }
});

// get normalized mouse coordinates
window.addEventListener("mousemove", onMouseMove, false);
