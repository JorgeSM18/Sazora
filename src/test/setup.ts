import '@testing-library/jest-dom/vitest';

// jsdom no implementa el scroll.
if (typeof window !== 'undefined') window.scrollTo = () => {};
