import {
  isNil,
  flow,
  map as fpMap,
} from 'lodash/fp'
const map = fpMap.convert({cap: false})

const get = (path, obj) => path.reduce((obj, field) => obj ? obj[field] : obj, obj)
const getCurried = path => obj => get(path, obj)

const getCounter = () => {
  let idCounter = 0
  return prefix => {
    var id = ++idCounter
    return id
  }
}
const uniqueId = getCounter()

// https://github.com/caiogondim/fast-memoize.js/blob/master/src/index.js
function ObjectWithoutPrototypeCache () {
  this.cache = Object.create(null)
}

ObjectWithoutPrototypeCache.prototype.has = function (key) {
  return (key in this.cache)
}

ObjectWithoutPrototypeCache.prototype.get = function (key) {
  return this.cache[key]
}

ObjectWithoutPrototypeCache.prototype.set = function (key, value) {
  this.cache[key] = value
}

ObjectWithoutPrototypeCache.prototype.delete = function (key) {
  delete this.cache[key]
}

class Context {
  constructor(id) {
    this.newCalls = []
    this.index = new ObjectWithoutPrototypeCache()
  }

  add(observable) {
    if (this.index.has(observable.id)) {
      this.index.set(observable.id, true)
      return
    }
    this.newCalls.push(observable)
  }

  getCalls() {
    return this.newCalls
  }

  getUnrequestedCalls() {
    const result = []
    map((requested, id) => {
      if (requested === false) {
        result.push(id)
        this.index.delete(id)
      } else {
        this.index.set(id, false)
      }
    }, this.index.cache)
    return result
  }

  mapUnrequestedCalls(cb) {
    map((requested, id) => {
      if (requested === false) {
        cb(id)
        this.index.delete(id)
      } else {
        this.index.set(id, false)
      }
    }, this.index.cache)
  }

  commit() {
    this.newCalls.map(observable => this.index.set(observable.id, false))
    this.newCalls = []
  }
}

class SxGlobals {
  constructor() {
    this.stack = []
    this.currentContext = null
    this.reactionsEnabled = true
    this.deferedReactions = null

    this.activeContextUpdater = observable => this.currentContext.add(observable)
    this.emptyContextUpdater = () => {}
    this.reportCall = this.emptyContextUpdater.bind(this)

    this.activeDeferedReactionsUpdater = reactions => this.deferedReactions.add(reactions)
    this.emptyDeferedReactionsUpdater = () => {}
    this.deferedReactionsUpdater = this.emptyDeferedReactionsUpdater

    this.contextCache = {}
    this.observables = new ObjectWithoutPrototypeCache()
  }

  createContext(id) {
    if (!this.contextCache[id]) this.contextCache[id] = new Context(id)
    this.stack.unshift(this.currentContext)
    this.currentContext = this.contextCache[id]
    this.reportCall = this.activeContextUpdater.bind(this)
    return this.currentContext
  }

  disposeContext() {
    if (this.stack.length === 0) {
      throw "Can't dispose more contexts"
    }

    this.currentContext = this.stack.shift()
    if (!this.currentContext) {
      this.reportCall = this.emptyContextUpdater.bind(this)
    }
  }

  // createDeferedReactionsContext() {
  //   this.deferedReactions = new Set()
  //   this.deferedReactionsUpdater = this.activeDeferedReactionsUpdater
  // }

  deferReactions(reactions) {
    this.deferedReactionsUpdater(reactions)
  }

  // clearDeferedReactions() {
  //   this.deferedReactions = null
  //   this.deferedReactionsUpdater = this.emptyDeferedReactionsUpdater
  // }

  disableReactions() {
    if (!this.reactionsEnabled) return () => {}
    this.reactionsEnabled = false
    return () => this.enableReactions()
  }

  enableReactions() {
    this.reactionsEnabled = true
  }
}
const SX = new SxGlobals()
const globalKey = '__sxGlobal'
window[globalKey] = SX

////

// https://github.com/then/is-promise/blob/master/index.js
function isPromise(obj) {
  return !!obj && (typeof obj === 'object' || typeof obj === 'function') && typeof obj.then === 'function';
}

////

class ObservableValue {
  constructor(name, value) {
    this.id = uniqueId('#')
    this.name = name
    this.value = value
    this.subscribers = new Set()
    SX.observables.set(this.id, this)
  }

  getValue() {
    // console.debug('getValue', this.name, this.value)
    SX.reportCall(this)
    return this.value
  }

  setValue(value) {
    // console.debug('ObservableValue.setValue', this.name, value)
    this.value = value
    if (SX.reactionsEnabled) {
      this.subscribers.forEach(cb => cb())
    // } else {
    //   SX.deferReactions(this.subscribers)
    }
  } 

  addSubscription(cb) {
    this.subscribers.add(cb)
  }

  removeSubscription(cb) {
    this.subscribers.delete(cb)
  }
}

class ComputedValue {
  constructor(cb, context, key) {
    this.id = uniqueId('$')
    this.cb = cb
    this.context = context
    this.subscribers = new Set()
    this.value = undefined
    this.subscribed = false
    this.key = key
    this.evaluateCb = () => this.evaluate()
    SX.observables.set(this.id, this)
  }

  evaluate() {
    if (!SX.reactionsEnabled) return
    SX.createContext(this.id)
    let result = this.cb.apply(this.context, [this.value])
    SX.currentContext.getCalls().map(observable => observable.addSubscription(this.evaluateCb))
    SX.currentContext.mapUnrequestedCalls(id => SX.observables.get(id).removeSubscription(this.evaluateCb))
    SX.currentContext.commit()
    SX.disposeContext()
    if (isPromise(result)) {
      result.then(value => this.updateValue(value))
      result = undefined
    } else {
      this.updateValue(result)
    }
    this.subscribed = true
    return result
  }

  getValue() {
    SX.reportCall(this)

    if (!this.subscribed) {
      this.evaluate()
    }
    return this.value
  }

  updateValue(value) {
    this.value = value
    this.subscribers.forEach(cb => cb())
  }

  addSubscription(cb) {
    this.subscribers.add(cb)
  }

  removeSubscription(cb) {
    this.subscribers.delete(cb)
  }
}

const isFunction = obj => !!(obj && obj.constructor && obj.call && obj.apply)

const IS_OBJECT_LITERAL = 'object'
const isObject = v => {
  // return v === Object(v)
  return v !== null && typeof v === IS_OBJECT_LITERAL
}
const isNotObject = v => {
  return v === null || typeof v !== IS_OBJECT_LITERAL
}

const META_KEY = '$$sx'

const ACCESSORS_DESCRIPTOR = {}

const modelMapper = (initValue, name, props) => {
  const observable = new ObservableValue(name, initValue)
  ACCESSORS_DESCRIPTOR.get = observable.getValue.bind(observable)
  ACCESSORS_DESCRIPTOR.set = observable.setValue.bind(observable)
  ACCESSORS_DESCRIPTOR.enumerable = true
  Object.defineProperty(props, name, ACCESSORS_DESCRIPTOR)
}
const viewsMapper = (value, name, result) => {
  const observable = new ComputedValue(value, result, name)
  ACCESSORS_DESCRIPTOR.get = observable.getValue.bind(observable)
  ACCESSORS_DESCRIPTOR.set = observable.updateValue.bind(observable)
  ACCESSORS_DESCRIPTOR.enumerable = true
  Object.defineProperty(result, name, ACCESSORS_DESCRIPTOR)
}
const actionsMapper = (value, name, result) => {
  ACCESSORS_DESCRIPTOR.get = function() {return value}
  ACCESSORS_DESCRIPTOR.set = function() {}
  ACCESSORS_DESCRIPTOR.enumerable = true
  Object.defineProperty(result, name, ACCESSORS_DESCRIPTOR)
}

const notNull = cb => (v, ...args) => isNil(v) ? cb({}, ...args) : cb(v, ...args)
export const model = fn => {
  const innerWrap = flow(
    notNull,
    cb => (v, ...args) => {
      const props = cb(v, ...args)
      map((initValue, name) => modelMapper(initValue, name, props), props)
      return props
    }
  )(fn)
  const extend = fn => {
    fn.postCreate = cb => flow(notNull, extend)((v, ...args) => {
      const result = fn(v, ...args)
      const props = cb(result, result)
      map((initValue, name) => modelMapper(initValue, name, result), props)
      return result
    })
    fn.views = props => flow(notNull ,extend)((v, ...args) => {
      const enableReactions = SX.disableReactions()
      const result = fn(v, ...args)
      enableReactions()
      map((value, name) => viewsMapper(value, name, result), props)
      return result
    })
    fn.actions = props => flow(notNull, extend)((v, ...args) => {
      const result = fn(v, ...args)
      map((value, name) => actionsMapper(value, name, result), props)
      return result
    })
    return fn
  }
  return extend(innerWrap)
}

////
export const autorun = cb => {
  const id = uniqueId('@')
  SX.createContext(id)
  cb()
  const calls = SX.currentContext.getCalls()
  calls.map(observable => observable.addSubscription(cb))
  SX.currentContext.mapUnrequestedCalls(id => SX.observables.get(id).removeSubscription(cb))
  SX.currentContext.commit()
  SX.disposeContext()
  const disposer = () => calls.map(observable => observable.removeSubscription(cb))
  disposer[META_KEY] = {id, calls, cb}
  return disposer
}

export const startWatch = disposer => SX.createContext(disposer[META_KEY].id)

export const stopWatch = disposer => {
  const {cb} = disposer[META_KEY]
  const calls = SX.currentContext.getCalls()
  SX.currentContext.mapUnrequestedCalls(id => SX.observables.get(id).removeSubscription(cb))
  SX.currentContext.commit()
  SX.disposeContext()
  return calls
}

export const extendSubscription = (disposer, newCalls) => {
  const {id, calls, cb} = disposer[META_KEY]
  newCalls.map(observable => {
    observable.addSubscription(cb)
    calls.push(observable)
  })
}

// const flatSets = sets => {
//   const result = new Set()
//   const mapper = s => result.add(s)
//   sets.forEach(s => s.forEach(mapper))
//   return result
// }
// export const batchUpdates = cb => {
//   SX.createDeferedReactionsContext()
//   const enableReactions = SX.disableReactions()
//   cb()
//   const deferedReactions = SX.deferedReactions
//   SX.clearDeferedReactions()
//   enableReactions()
//   flatSets(deferedReactions).forEach(cb => cb())
// }

import React from 'react'

function is(x, y) {
    // From: https://github.com/facebook/fbjs/blob/c69904a511b900266935168223063dd8772dfc40/packages/fbjs/src/core/shallowEqual.js
    if (x === y) {
        return x !== 0 || 1 / x === 1 / y
    } else {
        return x !== x && y !== y
    }
}

function shallowEqual(objA, objB) {
    //From: https://github.com/facebook/fbjs/blob/c69904a511b900266935168223063dd8772dfc40/packages/fbjs/src/core/shallowEqual.js
    if (is(objA, objB)) return true
    if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
        return false
    }
    const keysA = Object.keys(objA)
    const keysB = Object.keys(objB)
    if (keysA.length !== keysB.length) return false
    for (let i = 0; i < keysA.length; i++) {
        if (!hasOwnProperty.call(objB, keysA[i]) || !is(objA[keysA[i]], objB[keysA[i]])) {
            return false
        }
    }
    return true
}

export const observer = Component => {
  // console.debug('observe.construct')
  const result = class extends React.PureComponent {
    constructor(props) {
      super(props)
      this.component = Component
      this.props = props
      this.mounted = false
      this.disposer = autorun(() => this.mounted && this.forceUpdate())
    }

    componentDidMount() {
      this.mounted = true
    }

    componentWillUnmount() {
      this.disposer()
    }

    shouldComponentUpdate(nextProps, nextState) {
      return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState)
    }

    componentWillRender() {
      // console.debug('componentWillRender')
      startWatch(this.disposer)
    }

    componentDidRender() {
      const renderCalls = stopWatch(this.disposer)
      // console.debug('componentDidRender', {renderCalls})
      extendSubscription(this.disposer, renderCalls)
    }

    render() {
      // console.debug('observe.render', this.props)
      const prerender = <Component {...this.props}/>
      // console.debug('observe.render end', this.props, this, prerender)
      const prerenderClone = Object.assign({}, prerender)
      const origType = prerenderClone.type
      if (this.cachedPrerenderType) {
        prerenderClone.type = this.cachedPrerenderType
      } else {
        if(prerenderClone.type.prototype.render) {
          const observer = this
          prerenderClone.type = (...args) => {
            const result = new origType(...args)
            result.render = function(...args) {
              observer.componentWillRender()
              const result = this.__proto__.render.apply(this, args)
              observer.componentDidRender()
              return result
            }
            return result
          }
          this.cachedPrerenderType = prerenderClone.type
        } else {
          prerenderClone.type = (...args) => {
            this.componentWillRender()
            const result = origType(...args)
            this.componentDidRender()
            return result
          }
          this.cachedPrerenderType = prerenderClone.type
        }
      }
      return prerenderClone
    }
  }
  return result
}