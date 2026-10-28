export default defineEventHandler((event) => backend<ProfileWithAccounts>('profile', `/profiles/${getRouterParam(event, 'id')}`))
