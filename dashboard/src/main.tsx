import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiClientProvider, createClients } from './lib/clients/context';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><ApiClientProvider clients={createClients()}><App /></ApiClientProvider></BrowserRouter></React.StrictMode>);
