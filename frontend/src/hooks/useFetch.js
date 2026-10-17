// GET a resource and track loading / error state.
//
//   const { data, error, loading, reload } = useFetch('/users', { page, search });
//   const user = useFetch(id ? `/users/${id}` : null);   // null url = don't fetch
//
// While new params load, `data` keeps the previous result so a table does not
// flash empty between pages. Responses that arrive after the params changed
// again are ignored, so a slow old search can never overwrite a newer one.
import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';

export default function useFetch(url, params) {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState({ key: null, data: null, error: null });

  // One string that changes whenever anything that affects the request does.
  const key = JSON.stringify([url, params ?? null, reloadCount]);

  useEffect(() => {
    const [requestUrl, requestParams] = JSON.parse(key);
    if (!requestUrl) return undefined;
    let cancelled = false;
    api.get(requestUrl, { params: requestParams ?? undefined })
      .then(({ data }) => { if (!cancelled) setResult({ key, data, error: null }); })
      .catch((err) => {
        if (!cancelled) setResult((prev) => ({ key, data: prev.data, error: getErrorMessage(err) }));
      });
    return () => { cancelled = true; };
  }, [key]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  return {
    data: result.data,
    error: result.key === key ? result.error : null,
    loading: Boolean(url) && result.key !== key,
    reload,
  };
}
