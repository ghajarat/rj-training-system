// The signed-in trainee's plans, courses, progress and feedback
// (GET /api/me/plans), shared by My Dashboard and Training Materials.
//
//   const training = useMyTraining();
//   training.data      → { summary, plans } or null while loading
//   training.update(d) → show the { summary, plans } a write returned
//
// Every write (progress, feedback) answers with the whole refreshed list.
// Showing that answer, instead of patching one course by hand, keeps the
// cards, progress bars and totals in step: they all come from one response.
import { useCallback, useState } from 'react';
import useFetch from '../../hooks/useFetch';

export default function useMyTraining() {
  const fetched = useFetch('/me/plans');
  const [latest, setLatest] = useState(null);
  const { reload: refetch } = fetched;

  const reload = useCallback(() => {
    setLatest(null);
    refetch();
  }, [refetch]);

  return {
    data: latest ?? fetched.data,
    error: fetched.error,
    loading: fetched.loading,
    reload,
    update: setLatest,
  };
}

// Every course of every plan, with the plan details a course card needs.
export function flattenCourses(plans) {
  return plans.flatMap((plan) => plan.courses.map((course) => ({
    ...course,
    planId: plan.planId,
    planName: plan.planName,
    planDueDate: plan.dueDate,
    planStartDate: plan.startDate,
    planUpcoming: plan.upcoming,
    planCourseCount: plan.courses.length,
  })));
}

// The first unfinished course in plan order, in the open plan due soonest
// (the API already sorts plans by due date). Plans that have not started
// yet come last. null when everything is done.
export function nextCourse(plans) {
  const open = plans.filter((p) => p.status !== 'completed' && p.courses.length > 0);
  const ordered = [...open.filter((p) => !p.upcoming), ...open.filter((p) => p.upcoming)];
  for (const plan of ordered) {
    const course = plan.courses.find((c) => c.status !== 'completed');
    if (course) return { plan, course };
  }
  return null;
}
