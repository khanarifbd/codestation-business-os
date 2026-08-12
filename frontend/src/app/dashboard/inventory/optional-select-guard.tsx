"use client";

import { useEffect } from "react";

const OPTIONAL_EMPTY_LABELS = new Set(["No tax", "Uncategorized"]);

function normalizeOptionalSelects(root: ParentNode) {
  root.querySelectorAll<HTMLSelectElement>("select[required]").forEach((select) => {
    const emptyOption = Array.from(select.options).find((option) => option.value === "");
    if (emptyOption && OPTIONAL_EMPTY_LABELS.has(emptyOption.text.trim())) {
      select.required = false;
    }
  });
}

export function OptionalInventorySelectGuard() {
  useEffect(() => {
    normalizeOptionalSelects(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            normalizeOptionalSelects(node);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
