import { Outlet } from 'react-router-dom';
import './App.css';

function App() {
  return (
    <div className="app-container">
      {/* The Outlet is a placeholder where child routes will be rendered */}
      <Outlet />
    </div>
  );
}

export default App;