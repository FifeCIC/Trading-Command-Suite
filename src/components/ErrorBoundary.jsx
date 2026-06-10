/**
 * ErrorBoundary
 * =============
 * React class component that catches render errors in its subtree.
 * Can be nested for per-section granularity.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SeesScoringPanel />
 *   </ErrorBoundary>
 *
 *   <ErrorBoundary fallback={<CustomFallback />}>
 *     <RiskyComponent />
 *   </ErrorBoundary>
 */

import { Component } from 'react'
import ErrorDisplay from './ErrorDisplay'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // In production, send to error reporting service here
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      // Allow custom fallback via prop
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <ErrorDisplay
          severity="critical"
          message={this.props.message || 'Something went wrong rendering this section.'}
          error={this.state.error}
          onRetry={this.handleReset}
          className={this.props.className || ''}
        />
      )
    }

    return this.props.children
  }
}
