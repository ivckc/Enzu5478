// Put this in the <head> of your main page:
//   <script src="/cloud-auth-guard.js"></script>
// It (1) sends users to /login if they are not logged in,
// (2) asks "are you sure?" before ANY delete request leaves the browser.
(function () {
  var origFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    init = init || {};
    var method = (init.method || (input && input.method) || "GET").toUpperCase();

    if (method === "DELETE") {
      var ok = window.confirm("متأكد تريد تحذف؟ ما تكدر ترجعه بعدين.");
      if (!ok) {
        return new Response(JSON.stringify({ error: "cancelled" }), {
          status: 499,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (!init.credentials) init.credentials = "same-origin";
    var res = await origFetch(input, init);
    if (res.status === 401) window.location.href = "/login";
    return res;
  };

  origFetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) window.location.href = "/login";
  });
})();
