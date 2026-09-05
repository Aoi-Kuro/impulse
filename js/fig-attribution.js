// ─── Figure source attribution (i) badges ──────────────────────────────────
// Problem HTML (including .fig-attr badges) is injected dynamically via
// innerHTML, so we use event delegation on document instead of binding to
// specific elements. Hover/focus already reveals the tooltip via CSS; this
// just adds tap-to-toggle support for touch devices and closes any open
// tooltip when the user taps/clicks elsewhere.

document.addEventListener("click", function (e) {
  const icon = e.target.closest(".fig-attr-icon");
  const openOnes = document.querySelectorAll(".fig-attr.is-open");

  if (icon) {
    const badge = icon.closest(".fig-attr");
    const wasOpen = badge.classList.contains("is-open");
    openOnes.forEach((b) => b.classList.remove("is-open"));
    if (!wasOpen) badge.classList.add("is-open");
    e.preventDefault();
    return;
  }

  // Clicking a source link inside an open tooltip should just navigate,
  // not be treated as an "outside click".
  if (e.target.closest(".fig-attr-tip")) return;

  openOnes.forEach((b) => b.classList.remove("is-open"));
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    document
      .querySelectorAll(".fig-attr.is-open")
      .forEach((b) => b.classList.remove("is-open"));
  }
});
