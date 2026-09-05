/**
 * Applies the stored theme before first paint so the page never flashes the
 * wrong ground colour. Runs inline; there is no client component cost.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('sda-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}else if(window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
