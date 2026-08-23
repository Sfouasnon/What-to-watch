"use client";

import type { CSSProperties } from "react";

import styles from "./brand-sting.module.css";

type BrandMarkProps = { animated?: boolean; className?: string; label?: string; markSize?: number };
type BrandStingProps = { className?: string; markSize?: number; label?: string };

export function BrandMark({ animated = false, className = "", label = "What to Watch", markSize }: BrandMarkProps) {
  const style = markSize ? ({ "--brand-mark-size": `${markSize}px` } as CSSProperties) : undefined;
  return (
    <span className={`${styles.mark} ${animated ? styles.animatedMark : ""} ${className}`} style={style} role="img" aria-label={label}>
      <span className={styles.bloom} aria-hidden="true" />
      <span className={styles.frame} aria-hidden="true">
        <span className={`${styles.frameLine} ${styles.top}`} />
        <span className={`${styles.frameLine} ${styles.right}`} />
        <span className={`${styles.frameLine} ${styles.bottom}`} />
        <span className={`${styles.frameLine} ${styles.left}`} />
      </span>
      {animated ? <>
        <span className={`${styles.echo} ${styles.echoOne}`} aria-hidden="true">W</span>
        <span className={`${styles.echo} ${styles.echoTwo}`} aria-hidden="true">W</span>
        <span className={styles.ghost} aria-hidden="true">W</span>
      </> : null}
      <span className={styles.letter} aria-hidden="true">W</span>
    </span>
  );
}

export function BrandSting({ className = "", markSize = 220, label = "Loading What to Watch" }: BrandStingProps) {
  return (
    <div className={`${styles.stage} ${className}`} role="status" aria-label={label}>
      <span className={styles.projector} aria-hidden="true" />
      <span className={styles.aperture} aria-hidden="true" />
      <span className={styles.grain} aria-hidden="true" />
      <BrandMark animated label={label} markSize={markSize} />
    </div>
  );
}
