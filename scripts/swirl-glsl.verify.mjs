#!/usr/bin/env node
/** Actual GLSL paired-query agreement, using production materials/packers and
 * an RGBA32F target. CPU references use the public scalar and paired oracles.
 * Run on an idle GPU: node scripts/swirl-glsl.verify.mjs --display=:0
 * Both dimensions exercise signed posted finals, plain and Balloon queries,
 * full/cutoff evaluation and clip floors. No production marcher is replaced.
 */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { launchSurfaceBrowser } from "./lib/surface-browser-runner.mjs";

const display = process.argv
  .find((arg) => arg.startsWith("--display="))
  ?.slice(10);
const program = await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import * as THREE from 'three';
import * as material3 from './src/app/surface-material';
import * as material4 from './src/app/surface-material-4d';
import * as core3 from './src/fractal/surface-de';
import * as core4 from './src/fractal/surface-de-4d';
import * as balloon from './src/fractal/balloon-de';
import {sierpinskiTetrahedron,pentatope,swirlTetrahedronLens,swirlPentatopeLens} from './src/fractal/presets';
import {mulberry32} from './src/fractal/rng';
async function run() {
  THREE.ColorManagement.enabled=false;
  const renderer=new THREE.WebGLRenderer({antialias:false});
  renderer.setSize(1,1);
  const gl=renderer.getContext();
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  const backend=info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  if (!gl.getExtension('EXT_color_buffer_float')) throw Error('Float render targets unavailable');
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false});
  const camera=new THREE.Camera();
  const scene=new THREE.Scene();
  const geometry=new THREE.PlaneGeometry(2,2);
  const pixels=new Float32Array(4);
  const rng=mulberry32(0x5a711);
  const rows=[];
  for (const fourD of [false,true]) {
    const transforms=fourD?pentatope():sierpinskiTetrahedron();
    const final=fourD?swirlPentatopeLens():swirlTetrahedronLens();
    final.variations[0].weight*=-1;
    final.post={m:[0,1,0,-1,0,0,0,0,1],t:[.04,-.02,.01]};
    const de=fourD?core4.buildSurfaceDE4(transforms,final):core3.buildSurfaceDE(transforms,final);
    const rotor=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const w0=fourD?.031:0;
    const G=de.foldFinal.swirlLipschitz;
    const baseSample=(p,cutoff=0)=>fourD?core4.estimateDistance4RefinedSample(de,[...p,w0],cutoff):core3.estimateDistanceRefinedSample(de,p,cutoff);
    const baseScalar=(p,cutoff=0)=>fourD?core4.estimateDistance4Refined(de,[...p,w0],cutoff):core3.estimateDistanceRefined(de,p,cutoff);
    for (const echo of [false,true]) {
      const b=fourD?balloon.buildBalloon4(de,1.6):balloon.buildBalloon(de,1.6);
      const mat=fourD?material4.createSurfaceMaterial4():material3.createSurfaceMaterial();
      const colors=transforms.map(()=>[1,1,1]);
      if(fourD){material4.setSurfaceSystem4(mat,de,colors);material4.setSurfaceView4(mat,rotor,w0,0);material4.setSurface4Balloon(mat,echo?{...b,far:10*b.rho}:null);}
      else {material3.setSurfaceSystem(mat,de,colors);material3.setSurfaceBalloon(mat,echo?{...b,far:10*b.rho}:null);}
      const shader=mat.fragmentShader;
      const start=shader.lastIndexOf('void main()');
      if(start<0)throw Error('Missing production shader entry');
      mat.fragmentShader=shader.slice(0,start)+'uniform vec3 verifyPoint; uniform float verifyCutoff; uniform float verifyFloor; void main(){ vec2 pair=surfaceDEMarch(verifyPoint,verifyCutoff); outColor=vec4(max(pair,vec2(verifyFloor)),max(surfaceDE(verifyPoint,verifyCutoff),verifyFloor),1.0); }';
      mat.uniforms.verifyPoint={value:new THREE.Vector3()};
      mat.uniforms.verifyCutoff={value:0};
      mat.uniforms.verifyFloor={value:-1e20};
      const mesh=new THREE.Mesh(geometry,mat);
      mesh.frustumCulled=false;
      scene.add(mesh);
      const sample=(p,cutoff)=>!echo?baseSample(p,cutoff):fourD?balloon.estimateBalloonDistance4Sample(core4.estimateDistance4RefinedSample,de,b,p,w0,cutoff):balloon.estimateBalloonDistanceSample(core3.estimateDistanceRefinedSample,de,b,p,cutoff);
      const scalar=(p,cutoff)=>!echo?baseScalar(p,cutoff):fourD?balloon.estimateBalloonDistance4(core4.estimateDistance4Refined,de,b,p,w0,cutoff).d:balloon.estimateBalloonDistance(core3.estimateDistanceRefined,de,b,p,cutoff).d;
      let failures=0,maxRatio=0,accepted=0,rejected=0,improved=0,transition=0;
      const count=700;
      for(let i=0;i<count;i++){
        let p=Array.from({length:3},()=>Math.fround((rng()*2-1)*de.visibleBoundingRadius));
        if(echo&&i%2)p=balloon.invertBalloon(b,p).map(Math.fround);
        const full=sample(p,0);
        const cutoff=i%11===0?Math.fround(full.d/1.125):i%3===0?Math.fround(.025*de.boundingRadius/G):0;
        const floor=i%7===0?cutoff*2:-1e20;
        mat.uniforms.verifyPoint.value.set(...p);
        mat.uniforms.verifyCutoff.value=cutoff;
        mat.uniforms.verifyFloor.value=floor;
        renderer.setRenderTarget(target);renderer.render(scene,camera);
        renderer.readRenderTargetPixels(target,0,0,1,1,pixels);
        const cpu=sample(p,cutoff);
        const expected=[Math.max(cpu.stride,floor),Math.max(cpu.d,floor),Math.max(scalar(p,cutoff),floor)];
        if(cpu.d<cutoff)accepted++;else rejected++;
        if(cpu.stride>cpu.d*1.001)improved++;
        if(echo && cpu.d>=cutoff && cpu.stride<full.stride*.999)transition++;
        for(let lane=0;lane<3;lane++){
          const tolerance=Math.max(2e-4*de.boundingRadius,2e-3*Math.max(Math.abs(expected[lane]),.05*de.boundingRadius));
          // A cutoff-shortened value is intentionally inexact below cutoff;
          // its predicate is the contract, not its chosen early value.
          if(cutoff>0&&expected[lane]<cutoff&&pixels[lane]<cutoff)continue;
          const ratio=Math.abs(pixels[lane]-expected[lane])/tolerance;
          maxRatio=Math.max(maxRatio,ratio);
          if(!Number.isFinite(pixels[lane])||ratio>1)failures++;
        }
        if(pixels[3]!==1)throw Error('Shader did not draw a query');
      }
      rows.push({fourD,echo,count,failures,maxRatio,accepted,rejected,improved,transition});
      scene.remove(mesh);mat.dispose();
    }
  }
  geometry.dispose();target.dispose();renderer.dispose();
  return {backend,rows};
}
run().then(result=>window.__SWIRL_RESULT__=result).catch(error=>window.__SWIRL_ERROR__=String(error.stack||error));
`,
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
});
const browser = await launchSurfaceBrowser(display ? `x11:${display}` : "sw");
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addScriptTag({
    type: "module",
    content: program.outputFiles[0].text,
  });
  await page.waitForFunction(
    () => window.__SWIRL_RESULT__ || window.__SWIRL_ERROR__,
    null,
    { timeout: 180_000 },
  );
  const result = await page.evaluate(() => ({
    result: window.__SWIRL_RESULT__,
    error: window.__SWIRL_ERROR__,
  }));
  await mkdir("scripts/out/swirl-glsl", { recursive: true });
  await writeFile(
    "scripts/out/swirl-glsl/results.json",
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (
    result.error ||
    errors.length ||
    !result.result ||
    result.result.rows.some(
      (row) =>
        row.failures ||
        !row.improved ||
        !row.accepted ||
        !row.rejected ||
        (row.echo && !row.transition),
    )
  )
    process.exitCode = 1;
  if (
    display &&
    /swiftshader|llvmpipe|software/i.test(result.result?.backend ?? "")
  )
    process.exitCode = 2;
} finally {
  await browser.close();
}
