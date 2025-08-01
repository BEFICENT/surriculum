(function(){
  const btn = document.getElementById('themeToggle');
  const stored = localStorage.getItem('theme') || 'light';
  document.body.classList.remove('light-theme','dark-theme');
  document.body.classList.add(stored + '-theme');
  if(btn){
    btn.addEventListener('click',()=>{
      const current = document.body.classList.contains('dark-theme') ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.classList.remove(current+'-theme');
      document.body.classList.add(next+'-theme');
      localStorage.setItem('theme', next);
    });
  }
})();
