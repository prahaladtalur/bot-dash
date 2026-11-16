// Optional override. Leave DATA_URL empty and the page works it out by itself:
//   - on GitHub Pages (OWNER.github.io/REPO/) it reads
//       https://raw.githubusercontent.com/OWNER/REPO/data/dashboard.json
//   - anywhere else (Cloudflare Pages, local preview) it reads ./dashboard.json
// Set it only if your data lives somewhere else.
window.DASH_CONFIG = {
  DATA_URL: "",
  DATA_BRANCH: "data",
};
