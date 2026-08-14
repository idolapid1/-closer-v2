import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { gsap } from 'gsap';
import './MaskedHeading.css';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type MediaType = 'image' | 'video';
type RevealType = 'rise' | 'wipe' | 'fade' | 'none';
type TriggerType = 'view' | 'mount' | 'hover';
type TextAlign = 'left' | 'center' | 'right';

export interface MaskedHeadingProps
  extends Omit<HTMLAttributes<HTMLHeadingElement>, 'children' | 'style'> {
  text?: string;
  tag?: HeadingTag;
  mediaType?: MediaType;
  src: string;
  poster?: string;
  fillScale?: number;
  parallax?: number;
  drift?: number;
  brightness?: number;
  saturation?: number;
  grayscale?: boolean;
  reveal?: RevealType;
  duration?: number;
  stagger?: number;
  trigger?: TriggerType;
  align?: TextAlign;
  weight?: number;
  tracking?: number;
  lineHeight?: number;
  textScale?: number;
  className?: string;
  style?: CSSProperties;
}

interface MotionSettings {
  fillScale: number;
  parallax: number;
  drift: number;
  brightness: number;
  saturation: number;
  grayscale: boolean;
  textScale: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  value < minimum ? minimum : value > maximum ? maximum : value;

const wordDirection = (word: string): 'rtl' | 'ltr' =>
  /[\u0590-\u05ff]/.test(word) ? 'rtl' : 'ltr';

export function MaskedHeading({
  text = 'CLOSER עובד. נשאר רק להחליט.',
  tag = 'h1',
  mediaType = 'image',
  src,
  poster = '',
  fillScale = 1.2,
  parallax = 10,
  drift = 7,
  brightness = 1,
  saturation = 1.04,
  grayscale = false,
  reveal = 'rise',
  duration = 1,
  stagger = 0.055,
  trigger = 'mount',
  align = 'right',
  weight = 700,
  tracking = -0.035,
  lineHeight = 1.02,
  textScale = 0.074,
  className = '',
  style,
  ...rest
}: MaskedHeadingProps) {
  const rootRef = useRef<HTMLHeadingElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const revealRef = useRef<HTMLSpanElement>(null);
  const mediaRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const baseRefs = useRef<Array<HTMLElement | null>>([]);
  const glyphRefs = useRef<Array<SVGTextElement | null>>([]);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const offsetRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const clipId = `mh-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const words = useMemo(() => String(text).split(/\s+/).filter(Boolean), [text]);

  const settingsRef = useRef<MotionSettings>({
    fillScale,
    parallax,
    drift,
    brightness,
    saturation,
    grayscale,
    textScale,
  });
  settingsRef.current = {
    fillScale,
    parallax,
    drift,
    brightness,
    saturation,
    grayscale,
    textScale,
  };

  const place = useCallback(() => {
    const root = rootRef.current;
    const media = mediaRef.current;
    if (!root || !media) return;
    const settings = settingsRef.current;
    const maxX = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientWidth);
    const maxY = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientHeight);
    const offset = offsetRef.current;

    media.style.transform = `translate3d(${clamp(offset.x, -maxX, maxX).toFixed(2)}px, ${clamp(offset.y, -maxY, maxY).toFixed(2)}px, 0) scale(${settings.fillScale})`;
    media.style.filter = `brightness(${settings.brightness}) saturate(${settings.saturation})${settings.grayscale ? ' grayscale(1)' : ''}`;
  }, []);

  const sync = useCallback(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;

    root.style.fontSize = `${clamp(root.clientWidth * settingsRef.current.textScale, 30, 116).toFixed(1)}px`;
    const computed = window.getComputedStyle(measure);

    for (let index = 0; index < wordRefs.current.length; index += 1) {
      const box = wordRefs.current[index];
      const baseline = baseRefs.current[index];
      const glyph = glyphRefs.current[index];
      if (!box || !baseline || !glyph) continue;

      glyph.setAttribute('x', `${box.offsetLeft + box.offsetWidth}`);
      glyph.setAttribute('y', `${baseline.offsetTop}`);
      glyph.style.fontFamily = computed.fontFamily;
      glyph.style.fontSize = computed.fontSize;
      glyph.style.fontWeight = computed.fontWeight;
      glyph.style.fontStyle = computed.fontStyle;
      glyph.style.letterSpacing = computed.letterSpacing;
    }
    place();
  }, [place]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    sync();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    resizeObserver?.observe(root);
    if (!resizeObserver) window.addEventListener('resize', sync);
    void document.fonts?.ready.then(sync).catch(() => undefined);

    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true;
    if (reducedMotion) {
      place();
      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', sync);
      };
    }

    let animationFrame = 0;
    let previous = performance.now();
    let clock = 0;

    const frame = (now: number) => {
      const delta = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      clock += delta;
      const settings = settingsRef.current;
      const offset = offsetRef.current;
      const driftX = Math.sin(clock * 0.21) * settings.drift;
      const driftY = Math.cos(clock * 0.17) * settings.drift * 0.6;
      const easing = 1 - Math.exp(-delta / 0.18);
      offset.x += (offset.tx + driftX - offset.x) * easing;
      offset.y += (offset.ty + driftY - offset.y) * easing;
      place();
      animationFrame = requestAnimationFrame(frame);
    };

    const onMove = (event: PointerEvent) => {
      const settings = settingsRef.current;
      if (settings.parallax <= 0 || event.pointerType === 'touch') return;
      const bounds = root.getBoundingClientRect();
      const normalizedX = ((event.clientX - bounds.left) / (bounds.width || 1)) * 2 - 1;
      const normalizedY = ((event.clientY - bounds.top) / (bounds.height || 1)) * 2 - 1;
      offsetRef.current.tx = clamp(normalizedX, -1, 1) * -settings.parallax;
      offsetRef.current.ty = clamp(normalizedY, -1, 1) * -settings.parallax;
    };

    const onLeave = () => {
      offsetRef.current.tx = 0;
      offsetRef.current.ty = 0;
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    animationFrame = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', sync);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [place, sync]);

  useEffect(() => {
    sync();
  }, [align, lineHeight, sync, tag, textScale, tracking, weight, words]);

  useEffect(() => {
    const root = rootRef.current;
    const layer = revealRef.current;
    if (!root || !layer) return;
    const glyphs = glyphRefs.current.filter((glyph): glyph is SVGTextElement => glyph !== null);
    if (glyphs.length === 0) return;

    const riseDistance = () => (Number.parseFloat(window.getComputedStyle(root).fontSize) || 48) * 1.05;
    const settle = () => {
      gsap.set(glyphs, { y: 0 });
      gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
    };
    const rest = () => {
      if (reveal === 'rise') gsap.set(glyphs, { y: riseDistance() });
      if (reveal === 'wipe') gsap.set(layer, { clipPath: 'inset(0% 100% 0% 0%)' });
      if (reveal === 'fade') gsap.set(layer, { opacity: 0, scale: 1.04 });
    };
    const reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : true;
    if (reveal === 'none' || reducedMotion) {
      settle();
      return;
    }

    const play = () => {
      tweenRef.current?.kill();
      if (reveal === 'rise') {
        gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
        tweenRef.current = gsap.fromTo(
          glyphs,
          { y: riseDistance() },
          { y: 0, duration, stagger, ease: 'power4.out', overwrite: 'auto' },
        );
      } else if (reveal === 'wipe') {
        gsap.set(glyphs, { y: 0 });
        const state = { progress: 100 };
        tweenRef.current = gsap.to(state, {
          progress: 0,
          duration,
          ease: 'power3.inOut',
          overwrite: 'auto',
          onUpdate: () => {
            layer.style.clipPath = `inset(0% ${state.progress}% 0% 0%)`;
          },
        });
      } else {
        gsap.set(glyphs, { y: 0 });
        tweenRef.current = gsap.fromTo(
          layer,
          { opacity: 0, scale: 1.04 },
          { opacity: 1, scale: 1, duration, ease: 'power3.out', overwrite: 'auto' },
        );
      }
    };

    if (trigger === 'hover') {
      settle();
      root.addEventListener('pointerenter', play);
      return () => {
        root.removeEventListener('pointerenter', play);
        tweenRef.current?.kill();
      };
    }

    if (trigger === 'view' && 'IntersectionObserver' in window) {
      settle();
      rest();
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            play();
            intersectionObserver.disconnect();
          }
        },
        { threshold: 0.25 },
      );
      intersectionObserver.observe(root);
      return () => {
        intersectionObserver.disconnect();
        tweenRef.current?.kill();
      };
    }

    play();
    return () => tweenRef.current?.kill();
  }, [duration, reveal, stagger, trigger, words]);

  const Tag = tag;

  return (
    <Tag
      ref={rootRef}
      className={`masked-heading ${className}`.trim()}
      dir="rtl"
      style={{
        textAlign: align,
        fontWeight: weight,
        letterSpacing: `${tracking}em`,
        lineHeight,
        ...style,
      }}
      {...rest}
    >
      <span ref={measureRef} className="masked-heading__measure">
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            ref={(element) => {
              wordRefs.current[index] = element;
            }}
            className="masked-heading__word"
            dir={wordDirection(word)}
          >
            {word}
            <i
              ref={(element) => {
                baseRefs.current[index] = element;
              }}
              className="masked-heading__baseline"
            />
          </span>
        ))}
      </span>

      <svg className="masked-heading__defs" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            {words.map((word, index) => {
              const direction = wordDirection(word);
              return (
                <text
                  key={`${word}-${index}`}
                  ref={(element) => {
                    glyphRefs.current[index] = element;
                  }}
                  direction={direction}
                  textAnchor={direction === 'rtl' ? 'start' : 'end'}
                >
                  {word}
                </text>
              );
            })}
          </clipPath>
        </defs>
      </svg>

      <span ref={revealRef} className="masked-heading__reveal" aria-hidden="true">
        <span className="masked-heading__clip" style={{ clipPath: `url(#${clipId})` }}>
          <span ref={mediaRef} className="masked-heading__media">
            {mediaType === 'video' ? (
              <video
                className="masked-heading__source"
                src={src}
                poster={poster}
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                className="masked-heading__source"
                src={src}
                alt=""
                draggable={false}
                decoding="async"
              />
            )}
          </span>
        </span>
      </span>
    </Tag>
  );
}
