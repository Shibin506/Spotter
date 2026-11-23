import { createRoot } from 'react-dom/client';
import '../styles.css';
import './label.css';
import LabelApp from './LabelApp';

createRoot(document.getElementById('root')!).render(<LabelApp />);
