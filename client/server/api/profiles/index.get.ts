export default defineEventHandler((event) => {
  const { type } = getQuery(event)
  return backend<Profile[]>('profile', '/profiles', { type, limit: 200 })
})
