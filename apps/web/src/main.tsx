import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./lib/query.ts";
import { router } from "./router.tsx";
import "./styles/app.css";

try {
  const theme = localStorage.getItem("mf-theme");
  document.documentElement.classList.toggle("dark", theme ? theme === "dark" : true);
} catch {}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
