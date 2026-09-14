/**
 * The signed-in user, for a probe that has no cookies.
 *
 * Returns exactly what `getUser` returns to the route — an id and nothing the
 * chat path reads beyond it — so the handler runs its real authorisation
 * branch instead of being edited to skip it.
 */
module.exports = {
  getUser: async () => ({
    id: process.env.CHAT_PROBE_USER_ID,
    email: 'probe@local',
    user_metadata: {},
  }),
};
