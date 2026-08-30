/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakRadio */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "audience": "technical"
}/*EDITMODE-END*/;

function applyAudience(value) {
  document.body.setAttribute('data-audience', value);
}

function TweaksApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  React.useEffect(() => {
    applyAudience(t.audience);
  }, [t.audience]);

  return (
    <TweaksPanel>
      <TweakSection label="Audience" />
      <TweakRadio
        label="View"
        value={t.audience}
        options={['technical', 'exec']}
        onChange={(v) => setTweak('audience', v)}
      />
      <div style={{
        fontSize: 10.5,
        color: 'rgba(41,38,27,.55)',
        lineHeight: 1.4,
        padding: '0 0 4px'
      }}>
        Technical view shows code, schemas, and request traces.
        Exec view hides those and surfaces the why.
      </div>
    </TweaksPanel>
  );
}

// Mount on load
(function mount() {
  // also apply initial audience BEFORE React mounts so the first paint is correct
  applyAudience(TWEAK_DEFAULTS.audience);

  const host = document.getElementById('tweaks-root') || (() => {
    const el = document.createElement('div');
    el.id = 'tweaks-root';
    document.body.appendChild(el);
    return el;
  })();
  ReactDOM.createRoot(host).render(<TweaksApp />);
})();
