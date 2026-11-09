import type { CSSProperties } from 'react';

/**
 * The medallion layers as metals, shared by the Input node and the dataset
 * cards in its panel so a layer reads the same in both places: a dark base
 * with a lit diagonal, a bright rim, and text tinted the metal's colour.
 */
export type LayerName = 'gold' | 'silver' | 'bronze';

interface LayerTheme {
  /** Card face: dark at the corners, lit across the middle like brushed metal. */
  background: string;
  border: string;
  color: string;
  /** For headings and accents on a dark background. */
  accent: string;
}

export const LAYER_THEME: Record<LayerName, LayerTheme> = {
  gold: {
    background: 'linear-gradient(135deg, #3b2a05 0%, #6e5110 48%, #3b2a05 100%)',
    border: '#e0b43a',
    color: '#fff3c4',
    accent: '#f2c94c',
  },
  silver: {
    background: 'linear-gradient(135deg, #262c35 0%, #4f5965 48%, #262c35 100%)',
    border: '#cfd6df',
    color: '#f5f7fa',
    accent: '#d9dee5',
  },
  bronze: {
    background: 'linear-gradient(135deg, #341707 0%, #6b3413 48%, #341707 100%)',
    border: '#d08a4a',
    color: '#ffe2c6',
    accent: '#e3a066',
  },
};

export function isLayer(layer: string | undefined): layer is LayerName {
  return layer === 'gold' || layer === 'silver' || layer === 'bronze';
}

/** A layer's face as inline style: background, rim and text. */
export function layerStyle(layer: LayerName): CSSProperties {
  const theme = LAYER_THEME[layer];
  return { background: theme.background, borderColor: theme.border, color: theme.color };
}
