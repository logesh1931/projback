const express = require('express');
const { body, validationResult } = require('express-validator');
const Project = require('../models/Project');
const Task = require('../models/Task');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// Helper: check project access
async function getProjectForUser(projectId, userId) {
  const project = await Project.findById(projectId).populate('owner', 'name email');
  if (!project) return null;
  const isOwner = project.owner._id.toString() === userId.toString();
  const isMember = project.members.some((m) => m.user.toString() === userId.toString());
  if (!isOwner && !isMember) return null;
  return project;
}

// GET /api/projects — all projects for current user
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [{ owner: req.user._id }, { 'members.user': req.user._id }]
    })
      .populate('owner', 'name email')
      .sort('-createdAt');

    // Attach task counts
    const projectsWithCounts = await Promise.all(
      projects.map(async (p) => {
        const counts = await Task.aggregate([
          { $match: { project: p._id } },
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        const taskCounts = { todo: 0, 'in-progress': 0, review: 0, done: 0, total: 0 };
        counts.forEach((c) => {
          taskCounts[c._id] = c.count;
          taskCounts.total += c.count;
        });
        return { ...p.toObject(), taskCounts };
      })
    );

    res.json({ success: true, data: projectsWithCounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/projects — create project
router.post(
  '/',
  [body('name').trim().notEmpty().withMessage('Project name is required')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const project = await Project.create({
        ...req.body,
        owner: req.user._id
      });
      res.status(201).json({ success: true, data: project });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const project = await getProjectForUser(req.params.id, req.user._id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const tasks = await Task.find({ project: project._id })
      .populate('assignee', 'name email')
      .populate('createdBy', 'name')
      .sort('order');

    res.json({ success: true, data: { ...project.toObject(), tasks } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const allowed = ['name', 'description', 'color', 'status'];
    allowed.forEach((f) => {
      if (req.body[f] !== undefined) project[f] = req.body[f];
    });
    await project.save();
    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    await Task.deleteMany({ project: project._id });
    await project.deleteOne();
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/projects/:id/members — invite member by email
router.post('/:id/members', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const User = require('../models/User');
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const alreadyMember = project.members.some((m) => m.user.toString() === user._id.toString());
    if (alreadyMember)
      return res.status(400).json({ success: false, message: 'Already a member' });

    project.members.push({ user: user._id, role: req.body.role || 'member' });
    await project.save();
    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
