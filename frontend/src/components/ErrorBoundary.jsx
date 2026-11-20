import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('ResQRoute interface error:', error, info); }
  render() {
    if (this.state.failed) return (
      <main className="fatal-error">
        <p className="eyebrow">RESQROUTE</p>
        <h1>The workspace could not be displayed.</h1>
        <p>Reload the workspace to try again. If the issue continues, contact the person supporting this application.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>Reload workspace</button>
      </main>
    );
    return this.props.children;
  }
}
