import {
  useCallback,
  useEffect,
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

const justifyContent = (align: TextAlign): CSSProperties['justifyContent'] => {
  if (align === 'center') return 'center';
  return align === 'right' ? 'flex-start' : 'flex-end';
};

export function MaskedHeading({
  text = 'CLOSER עובד. אתה רק מחליט.',
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
  const revealRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const offsetRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const words = useMemo(() => String(text).split(/\s+/).filter(Boolean), [text]);
  const materialSource = mediaType === 'video' ? poster : src;

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
    if (!root) return;
    const settings = settingsRef.current;
    const maxX = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientWidth);
    const maxY = Math.max(0, ((settings.fillScale - 1) / 2) * root.clientHeight);
    const offset = offsetRef.current;
    root.style.setProperty('--mh-x', `${clamp(offset.x, -maxX, maxX).toFixed(2)}px`);
    root.style.setProperty('--mh-y', `${clamp(offset.y, -maxY, maxY).toFixed(2)}px`);
    root.style.setProperty('--mh-fill-scale', `${settings.fillScale * 100}%`);
    root.style.setProperty('--mh-filter', `brightness(${settings.brightness}) saturate(${settings.saturation})${settings.grayscale ? ' grayscale(1)' : ''}`);
  }, []);

  const sync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.fontSize = `${clamp(root.clientWidth * settingsRef.current.textScale, 30, 116).toFixed(1)}px`;
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
    const wordElements = wordRefs.current.filter((word): word is HTMLSpanElement => word !== null);
    if (wordElements.length === 0) return;

    const settle = () => {
      gsap.set(wordElements, { yPercent: 0, opacity: 1 });
      gsap.set(layer, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
    };
    const rest = () => {
      if (reveal === 'rise') gsap.set(wordElements, { yPercent: 110, opacity: 0 });
      if (reveal === 'wipe') gsap.set(layer, { clipPath: 'inset(0% 100% 0% 0%)' });
      if (reveal === 'fade') gsap.set(layer, { opacity: 0, scale: 1.035 });
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
        tweenRef.current = gsap.to(wordElements, {
          yPercent: 0,
          opacity: 1,
          duration,
          stagger,
          ease: 'power4.out',
          overwrite: 'auto',
        });
      } else if (reveal === 'wipe') {
        tweenRef.current = gsap.to(layer, {
          clipPath: 'inset(0% 0% 0% 0%)',
          duration,
          ease: 'power3.inOut',
          overwrite: 'auto',
        });
      } else {
        tweenRef.current = gsap.to(layer, {
          opacity: 1,
          scale: 1,
          duration,
          ease: 'power3.out',
          overwrite: 'auto',
        });
      }
    };

    rest();
    if (trigger === 'hover') {
      settle();
      root.addEventListener('pointerenter', play);
      return () => {
        root.removeEventListener('pointerenter', play);
        tweenRef.current?.kill();
      };
    }
    if (trigger === 'view' && 'IntersectionObserver' in window) {
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
  const materialStyle = {
    '--mh-image': materialSource ? `url(${materialSource})` : 'none',
    textAlign: align,
    fontWeight: weight,
    letterSpacing: `${tracking}em`,
    lineHeight,
    ...style,
  } as CSSProperties;

  return (
    <Tag
      ref={rootRef}
      className={`masked-heading ${className}`.trim()}
      dir="rtl"
      style={materialStyle}
      {...rest}
    >
      <span className="sr-only">{text}</span>
      <span
        ref={revealRef}
        className="masked-heading__content"
        aria-hidden="true"
        style={{ justifyContent: justifyContent(align) }}
      >
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            ref={(element) => {
              wordRefs.current[index] = element;
            }}
            className="masked-heading__word"
            dir={wordDirection(word)}
            data-direction={wordDirection(word)}
          >
            {word}
          </span>
        ))}
      </span>
    </Tag>
  );
}
