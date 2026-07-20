// BambooGrid progressive-enhancement embed script.
// Replaces <div class="bamboogrid-embed" data-src="..." data-height="...">
// elements with iframes. Falls back gracefully when JS is off.
(function () {
  var embeds = document.querySelectorAll(".bamboogrid-embed[data-src]");
  for (var i = 0; i < embeds.length; i++) {
    var el = embeds[i];
    var src = el.getAttribute("data-src");
    var height = el.getAttribute("data-height") || "500";
    if (!src) continue;
    var iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.width = "100%";
    iframe.height = height;
    iframe.style.cssText =
      "border:1px solid #e0e0e0;border-radius:8px;display:block;";
    iframe.loading = "lazy";
    iframe.sandbox = "allow-scripts allow-same-origin";
    iframe.title = "BambooGrid Scenario";
    el.parentNode.replaceChild(iframe, el);
  }
})();
