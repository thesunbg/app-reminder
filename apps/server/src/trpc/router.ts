import { router } from './trpc.js'
import { authRouter } from './routers/auth.js'
import { diaryRouter } from './routers/diary.js'
import { eventRouter } from './routers/event.js'
import { familyRouter } from './routers/family.js'
import { holidayRouter } from './routers/holiday.js'
import { noteRouter } from './routers/note.js'
import { notifyRouter } from './routers/notify.js'
import { routineRouter } from './routers/routine.js'
import { searchRouter } from './routers/search.js'
import { screenRouter } from './routers/screen.js'
import { statsRouter } from './routers/stats.js'
import { studyRouter } from './routers/study.js'

export const appRouter = router({
  auth: authRouter,
  diary: diaryRouter,
  event: eventRouter,
  family: familyRouter,
  holiday: holidayRouter,
  note: noteRouter,
  notify: notifyRouter,
  routine: routineRouter,
  search: searchRouter,
  screen: screenRouter,
  stats: statsRouter,
  study: studyRouter,
})

export type AppRouter = typeof appRouter
