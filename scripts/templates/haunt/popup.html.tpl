<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Poltergeist: __HAUNT_NAME__</title>
  <link rel="stylesheet" href="popup.css">
  <script type="module" src="popup.js"></script>
</head>
<body>
  <main>
    <h1>Poltergeist: __HAUNT_NAME__</h1>
    <p id="status" class="status" role="status" aria-live="polite" data-state="loading">Checking this tab…</p>
    <form id="controls" class="controls">
      <label class="control" for="pause">
        <input type="checkbox" id="pause" name="pause" disabled>
        <span>Pause on this tab</span>
      </label>
      <label class="control" for="demo">
        <input type="checkbox" id="demo" name="demo" disabled>
        <span>Demo mode (thresholds ÷ 60, applies on the next page load)</span>
      </label>
    </form>
  </main>
</body>
</html>
