import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const router = getRouter();

router.subscribe("onResolved", () => {
  const m = [...router.state.matches].reverse().find((x: any) => x.meta?.some?.((t: any) => t?.title));
  const t = (m as any)?.meta?.find((x: any) => x?.title)?.title;
  if (t) document.title = t;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
