// PDF originales de cada usuario. El servidor los guarda al importarlos y solo se los sirve a su dueño
// (/api/documentos/…). Los documentos de los datos de prueba no tienen PDF enlazado.

import { useStore } from '../state/store';

/** URL del PDF del documento, abierta en la página indicada (#page=N lo entienden los visores de PDF). */
export function useDocumentUrl() {
  const { data } = useStore();
  return (docId: string, page?: number) => {
    const url = data.documents.find((d) => d.id === docId)?.file;
    if (!url?.startsWith('/api/documentos/')) return undefined;
    return page ? `${url}#page=${page}` : url;
  };
}
