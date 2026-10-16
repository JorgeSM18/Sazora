// Dudas de la importación: las de la pauta y las de los documentos que usa (p. ej. su lista de alimentos).

import type { AppData, ReviewItem } from './types';

export function reviewItems(data: Pick<AppData, 'diet' | 'documents'>): ReviewItem[] {
  if (!data.diet) return [];
  const docs = new Set(data.diet.documents);
  return [...data.diet.review, ...data.documents.filter((d) => docs.has(d.id)).flatMap((d) => d.review ?? [])];
}

export function setReviewResolved(data: AppData, id: string, resolved: boolean): AppData {
  const mark = (items: ReviewItem[] = []) => items.map((r) => (r.id === id ? { ...r, resolved } : r));
  return {
    ...data,
    diet: data.diet && { ...data.diet, review: mark(data.diet.review) },
    documents: data.documents.map((d) => (d.review?.some((r) => r.id === id) ? { ...d, review: mark(d.review) } : d)),
  };
}
