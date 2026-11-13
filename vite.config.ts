import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static build for GitHub Pages: relative asset paths, so it works under /<repo>/ as well as at a domain root.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
