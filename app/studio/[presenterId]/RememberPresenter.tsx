"use client";

import { useEffect } from "react";

const LAST_PRESENTER_KEY = "idive:lastPresenterId";

export default function RememberPresenter({ presenterId }: { presenterId: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PRESENTER_KEY, presenterId);
    } catch {
      // ignore
    }
  }, [presenterId]);

  return null;
}