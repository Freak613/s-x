# S-X

MobX inspired state management library.

### Main differences:
- Consider this as MobX recreated from scratch. Can be faster or slower than original in different cases.
- Async computed properties
- Async actions without yields. Can use async/await
- Stateful computed properties
- Mobx-State-Tree inspired store organization
- Arrays are not wrapped and can be used with any lodash function. Therefore it's not observable, but parent and children can be observables.

## The Gist

```javascript
import {model, observer} from 's-x'

const Todo = model(({title, done}) => ({
    title,
    done
}))
.postCreate(({title}) => ({
    title: capitalize(title)
}))
.views({
    isDone() { return this.done },
    async asyncIsDone() { 
        const result = await Promise.resolve(true)
        return result
    }
})
.actions({
    markDone() { this.done = true },
    asyncMarkDone() {
        const result = await Promise.resolve(true)
        this.done = true
        return result
    }
})

const Todos = model(({todos}) => ({
    todos: todos.map(Todo)
}))
.views({
    todosById() { return keyBy('id', this.todos) },
    todosCount() { return this.todos.length }
})
.actions({
    markAllDone() { this.todos.map(todo => todo.done = true) }
})

const state = Todos({todos: []})

// Wrap React components to observe the state
const TodosCount = observer(({todos}) => <div>{todos.length}</div>)
...
<TodosCount todos={state.todos}/>

```
