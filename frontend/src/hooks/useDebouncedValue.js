// Returns `value` only after it has stopped changing for `delay` ms.
// Used by search boxes so typing "omar" sends one request, not four.
import { useEffect, useState } from 'react';

export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
