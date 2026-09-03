<script>
  /** An "i" button that opens its content in a native popover — where long explanations go to hide. */
  let { children, label = 'Explain', w = 380 } = $props();
  const id = `pop${Math.random().toString(36).slice(2, 9)}`;
</script>

<button type="button" class="lab-info" popovertarget={id} aria-label={label} title={label}>i</button>
<div {id} popover="auto" class="lab-pop" style="--w:{w}px">
  <div class="lab-rule start mb-2">{label}</div>
  {@render children()}
</div>
