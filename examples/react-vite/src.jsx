import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [count, setCount] = React.useState(0);
  return (
    <main>
      <span className="badge">LOCAL DEVELOPMENT / ONLINE</span>
      <h1>Less setup.<br /><span>Just run.</span></h1>
      <p>This React + Vite app was detected, installed, and started by a single command.</p>
      <pre><span>$</span> run</pre>
      <div className="status"><i /> React + Vite <span>·</span> localhost:5173</div>
      <button onClick={() => setCount(count + 1)}>Clicked {count} {count === 1 ? 'time' : 'times'} ↗</button>
      <footer>github.com/xonix97/run</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
