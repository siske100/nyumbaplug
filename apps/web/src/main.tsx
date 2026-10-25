import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { applyDevice } from "./lib/device";
import { queryClient, setUnauthorizedHandler } from "./lib/queryClient";

applyDevice();

// Devtools are loaded only in development and never ship in the production bundle.
const Devtools = import.meta.env.DEV
  ? lazy(() => import("@tanstack/react-query-devtools").then((m) => ({ default: m.ReactQueryDevtools })))
  : () => null;

// A 401 from anywhere: drop every cached private result and return to sign-in.
setUnauthorizedHandler(() => {
  queryClient.clear();
  if (location.pathname !== "/sign-in") location.assign("/sign-in");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Suspense fallback={null}><Devtools /></Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
