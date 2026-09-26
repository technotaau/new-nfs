// Stain swatches carried over from fsv (fence-staining-visualizer/wordpress/app.js).
// contrast = grain contrast around the swatch per family (fsv FAMILY_CONTRAST).
export const SWATCH_GROUPS = [
  {
    family: 'general', label: 'General', contrast: 1.08,
    colors: [
      { name: 'Natural Cedar', hex: '#A37033' },
      { name: 'Oxford Brown', hex: '#4B4036' },
      { name: 'Redwood', hex: '#9D4A22' },
      { name: 'Leatherwood', hex: '#8B572A' },
      { name: 'Cedar Tone', hex: '#A35E29' },
    ],
  },
  {
    family: 'semi-transparent', label: 'Semi-transparent', contrast: 1.15,
    colors: [
      { name: 'Chestnut', hex: '#56402E' },
      { name: 'Mahogany', hex: '#6F2B23' },
      { name: 'Pecan', hex: '#A0784E' },
      { name: 'Sequoia', hex: '#813F2D' },
      { name: 'Walnut', hex: '#5D4037' },
    ],
  },
  {
    family: 'semi-solid', label: 'Semi-solid', contrast: 1.0,
    colors: [
      { name: 'Auburn', hex: '#7A3326' },
      { name: 'Barnwood', hex: '#7A6E62' },
      { name: 'Black', hex: '#1A1A1A' },
      { name: 'Cape Cod Gray', hex: '#888B85' },
      { name: 'Chocolate', hex: '#3F2A1F' },
      { name: 'Eucalyptus', hex: '#6E7B6F' },
      { name: 'Palomino', hex: '#C4986E' },
      { name: 'Sable', hex: '#3B2E27' },
      { name: 'Slate Gray', hex: '#5C636D' },
    ],
  },
];
