(function () {
  var saved = localStorage.getItem("theme");
  var dark = saved !== "light";
  if (dark) document.documentElement.classList.add("dark");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0c0c0e" : "#f3f5f9");
})();