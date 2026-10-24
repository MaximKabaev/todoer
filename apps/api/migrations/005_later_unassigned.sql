-- Later is the shared "not planned yet" list: its tasks have no assignees.
DELETE FROM task_assignees a USING tasks t WHERE t.id = a.task_id AND t.list = 'later';
