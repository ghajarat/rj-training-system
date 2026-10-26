// Helpers shared by the citation chips and the side panel (FR11).
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { openDocument } from '../../api/documents';

// "5.3 Smoke hoods · page 4"
export function sourcePlace(citation) {
  return [citation.section, citation.page && `page ${citation.page}`].filter(Boolean).join(' · ');
}

// Opens a cited SOP; tracks which one is loading and any error.
export function useOpenSource() {
  const [state, setState] = useState({ busyId: null, error: null });
  const open = async (docId) => {
    setState({ busyId: docId, error: null });
    try {
      await openDocument(docId);
      setState({ busyId: null, error: null });
    } catch (err) {
      setState({ busyId: null, error: getErrorMessage(err) });
    }
  };
  return { ...state, open };
}
