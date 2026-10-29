// Applies a saved theme before first paint so it doesn't flash. Loaded as its own file
// because the Content-Security-Policy blocks inline scripts. src/main.ts saves the choice.
try {
  var theme = localStorage.getItem("hideit:theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage unavailable: follow the OS setting.
}
