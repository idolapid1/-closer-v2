import { useEffect, useRef } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import './MoltenMetal.css';

export interface MoltenMetalProps {
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  scale?: number;
  detail?: number;
  glow?: number;
  coreSize?: number;
  swirl?: number;
  fold?: number;
  blackPoint?: number;
  brightness?: number;
  colorMode?: 'molten' | 'ember' | 'frost';
  grain?: boolean;
  grainIntensity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  opacity?: number;
  maxDpr?: number;
  className?: string;
}

interface MoltenContext {
  renderer: Renderer;
  program: Program;
  mesh: Mesh;
  isMobile: boolean;
  reducedMotion: boolean;
}

const contextMap = new WeakMap<HTMLDivElement, MoltenContext>();

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    Number.parseInt(result[1] ?? 'ff', 16) / 255,
    Number.parseInt(result[2] ?? 'ff', 16) / 255,
    Number.parseInt(result[3] ?? 'ff', 16) / 255,
  ];
};

const colorModeToFloat = (mode: MoltenMetalProps['colorMode']) =>
  mode === 'ember' ? 1 : mode === 'frost' ? 2 : 0;

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uColorMode;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;
  vec2 drift = vec2(0.0);
  if (uEnableMouse) drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  p += drift;
  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;
  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
  }

  c /= 6.0;
  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;
  float g = clamp(intensity, 0.0, 1.0);
  float mid = 0.5;
  if (uColorMode > 1.5) mid = 0.65;
  else if (uColorMode > 0.5) mid = 0.35;
  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
  col = mix(col, uColor3, smoothstep(mid, 1.0, g));
  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * a, a);
}
`;

export function MoltenMetal({
  color1 = '#15102A',
  color2 = '#5227FF',
  color3 = '#B9C7FF',
  speed = 0.22,
  scale = 4.5,
  detail = 3,
  glow = 1.25,
  coreSize = 0.08,
  swirl = 0.9,
  fold = -0.2,
  blackPoint = 0.08,
  brightness = 1.15,
  colorMode = 'molten',
  grain = true,
  grainIntensity = 0.035,
  mouseInteraction = true,
  mouseStrength = 0.12,
  opacity = 0.72,
  maxDpr = 1.6,
  className = '',
}: MoltenMetalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true;
    const isMobile = window.matchMedia?.('(max-width: 820px)').matches ?? false;
    const hasWebGl2 = typeof window.WebGL2RenderingContext !== 'undefined';
    if (reducedMotion || !hasWebGl2) {
      container.dataset.renderer = 'static';
      return;
    }

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        powerPreference: isMobile ? 'low-power' : 'high-performance',
        dpr: Math.min(window.devicePixelRatio || 1, isMobile ? 1.15 : maxDpr),
      });
    } catch {
      container.dataset.renderer = 'static';
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: 0.22 },
        uScale: { value: 4.5 },
        uDetail: { value: 3 },
        uGlow: { value: 1.25 },
        uCoreSize: { value: 0.08 },
        uSwirl: { value: 0.9 },
        uFold: { value: -0.2 },
        uBlackPoint: { value: 0.08 },
        uBrightness: { value: 1.15 },
        uColorMode: { value: 0 },
        uGrain: { value: 1 },
        uGrainIntensity: { value: 0.035 },
        uOpacity: { value: 0.72 },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: 0.12 },
        uEnableMouse: { value: true },
        uColor1: { value: new Float32Array([1, 1, 1]) },
        uColor2: { value: new Float32Array([1, 1, 1]) },
        uColor3: { value: new Float32Array([1, 1, 1]) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });
    contextMap.set(container, { renderer, program, mesh, isMobile, reducedMotion });
    container.dataset.renderer = 'webgl';

    const setSize = () => {
      const bounds = container.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(bounds.width)), Math.max(1, Math.floor(bounds.height)));
      const resolution = program.uniforms.iResolution.value as Float32Array;
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };

    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(container);
    setSize();

    const targetMouse: [number, number] = [0.5, 0.5];
    const currentMouse: [number, number] = [0.5, 0.5];
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) return;
      targetMouse[0] = (event.clientX - bounds.left) / (bounds.width || 1);
      targetMouse[1] = 1 - (event.clientY - bounds.top) / (bounds.height || 1);
    };
    const resetPointer = () => {
      targetMouse[0] = 0.5;
      targetMouse[1] = 0.5;
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('blur', resetPointer);

    let animationFrame = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const startedAt = performance.now();

    const loop = (timestamp: number) => {
      program.uniforms.iTime.value = (timestamp - startedAt) * 0.001;
      currentMouse[0] += 0.045 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.045 * (targetMouse[1] - currentMouse[1]);
      const mouse = program.uniforms.uMouse.value as Float32Array;
      mouse[0] = currentMouse[0];
      mouse[1] = currentMouse[1];
      renderer.render({ scene: mesh });
      animationFrame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (isVisible && isPageVisible && animationFrame === 0) {
        animationFrame = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      if (animationFrame !== 0) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) start();
        else stop();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('blur', resetPointer);
      contextMap.delete(container);
      canvas.remove();
      program.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      delete container.dataset.renderer;
    };
  }, [maxDpr]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const context = contextMap.get(container);
    if (!context) return;
    const uniforms = context.program.uniforms;
    const mobileFactor = context.isMobile ? 0.74 : 1;
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;

    uniforms.uSpeed.value = speed;
    uniforms.uScale.value = scale;
    uniforms.uDetail.value = context.isMobile ? Math.min(detail, 2) : detail;
    uniforms.uGlow.value = glow * mobileFactor;
    uniforms.uCoreSize.value = Math.max(coreSize, 0.001);
    uniforms.uSwirl.value = swirl;
    uniforms.uFold.value = fold;
    uniforms.uBlackPoint.value = blackPoint;
    uniforms.uBrightness.value = brightness;
    uniforms.uColorMode.value = colorModeToFloat(colorMode);
    uniforms.uGrain.value = grain && !context.isMobile ? 1 : 0;
    uniforms.uGrainIntensity.value = grainIntensity;
    uniforms.uOpacity.value = opacity * (context.isMobile ? 0.72 : 1);
    uniforms.uMouseStrength.value = mouseStrength;
    uniforms.uEnableMouse.value = mouseInteraction && finePointer && !context.isMobile;

    const colors = [hexToRgb(color1), hexToRgb(color2), hexToRgb(color3)];
    const targets = [uniforms.uColor1.value, uniforms.uColor2.value, uniforms.uColor3.value] as Float32Array[];
    targets.forEach((target, index) => {
      const color = colors[index];
      if (!color) return;
      target[0] = color[0];
      target[1] = color[1];
      target[2] = color[2];
    });
    context.renderer.render({ scene: context.mesh });
  }, [
    blackPoint,
    brightness,
    color1,
    color2,
    color3,
    colorMode,
    coreSize,
    detail,
    fold,
    glow,
    grain,
    grainIntensity,
    mouseInteraction,
    mouseStrength,
    opacity,
    scale,
    speed,
    swirl,
  ]);

  return (
    <div
      ref={containerRef}
      className={`molten-metal-container ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
