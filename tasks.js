const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// Helper: verify user has access to the project
async function hasProjectAccess(projectId, userId) {
  const project = await Project.findById(projectId);
  if (!project) return false;
  const isOwner = project.owner.toString() === userId.toString();
  const isMember = project.members.some((m) => m.user.toString() === userId.toString());
  return isOwner || isMember;
}

// GET /api/tasks?project=:id&status=&assignee=&priority=
router.get('/', async (req, res) => {
  try {
    const { project, status, assignee, priority } = req.query;
    if (!project) return res.status(400).json({ success: false, message: 'project query param required' });

    const access = await hasProjectAccess(project, req.user._id);
    if (!access) return res.status(403).json({ success: false, message: 'Access denied' });

    const filter = { project };
    if (status) filter.status = status;
    if (assignee) filter.assignee = assignee;
    if (priority) filter.priority = priority;

    const tasks = await Task.find(filter)
      .populate('assignee', 'name email')
      .populate('createdBy', 'name')
      .sort('order createdAt');

    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/tasks
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('project').notEmpty().withMessage('Project ID is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const access = await hasProjectAccess(req.body.project, req.user._id);
      if (!access) return res.status(403).json({ success: false, message: 'Access denied' });

      // Set order to end of column
      const count = await Task.countDocuments({
        project: req.body.project,
        status: req.body.status || 'todo'
      });

      const task = await Task.create({
        ...req.body,
        createdBy: req.user._id,
        order: count
      });

      const populated = await task.populate([
        { path: 'assignee', select: 'name email' },
        { path: 'createdBy', select: 'name' }
      ]);

      res.status(201).json({ success: true, data: populated });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// GET /api/tasks/:id
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignee', 'name email')
      .populate('createdBy', 'name')
      .populate('project', 'name color');

    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const access = await hasProjectAccess(task.project._id, req.user._id);
    if (!access) return res.status(403).json({ success: false, message: 'Access denied' });

    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const access = await hasProjectAccess(task.project, req.user._id);
    if (!access) return res.status(403).json({ success: false, message: 'Access denied' });

    const allowed = ['title', 'description', 'status', 'priority', 'assignee', 'deadline', 'order', 'tags'];
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) task[f] = req.body[f];
    });
    await task.save();

    const populated = await task.populate([
      { path: 'assignee', select: 'name email' },
      { path: 'createdBy', select: 'name' }
    ]);

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const access = await hasProjectAccess(task.project, req.user._id);
    if (!access) return res.status(403).json({ success: false, message: 'Access denied' });

    await task.deleteOne();
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
