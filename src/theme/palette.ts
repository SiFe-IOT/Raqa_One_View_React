// Material colour values used by the Flutter app.
export const C = {
  grey: '#9E9E9E',
  black: '#000000',
  white: '#FFFFFF',
  red: '#F44336',
  redAccent: '#FF5252',
  green: '#4CAF50',
  orange: '#FF9800',
  blue: '#2196F3',
  blueAccent: '#448AFF',
  lightBlue: '#03A9F4',
  cyan: '#00BCD4',
  blueGrey: '#607D8B',
  teal: '#009688',
  teal400: '#26A69A',
  teal700: '#00796B',
  tealAccent: '#64FFDA',
  tealAccent400: '#1DE9B6',
  purple: '#7003FA',
};

export const withOpacity = (hex: string, opacity: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
};
