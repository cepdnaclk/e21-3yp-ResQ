Manikin Auscultation Overlay System

This repository contains our Embedded Systems 3YP project: a smart auscultation training module that helps medical students practice accurate cardiac and respiratory auscultation on existing manikins.

Project Overview

Current training manikins often play heart and lung sounds without giving strong feedback about whether the student is listening at the correct anatomical landmark. Our system provides real-time placement guidance and performance tracking to improve landmarking skills and support structured assessment.

What We Are Building

Our solution is a retrofit system designed to work with existing manikins, consisting of:

Chest overlay sensing layer: a thin wearable overlay placed on the manikin chest, used to detect stethoscope placement using force/pressure sensing at standard auscultation zones (heart valve areas and lung fields).

Stethoscope audio adapter (cap): a lightweight cap that fits over the stethoscope chestpiece and injects the selected training sound through a compact speaker, reducing the need for multiple under-skin transducers.

Control box + embedded controller: processes placement accuracy in real-time, selects appropriate sound profiles (normal/pathological), and manages communication and updates.

Tablet Web App (PWA): provides a clear accuracy indicator and guided practice interface for students.

Cloud + Instructor dashboard: supports live monitoring, session logging, analytics (accuracy, time-to-find, attempts), and instructor-controlled sound library updates.

Key Features

Placement accuracy feedback (Perfect / Near / Far) with near-miss fading based on stethoscope position

Guided practice mode and assessment mode with automatic scoring

Live instructor monitoring and session reports

Cloud-managed sound library with local device caching for reliable playback

Expected Impact

This system aims to improve:

Students’ ability to identify correct auscultation landmarks

Training quality through repeatable scenarios (normal + abnormal sounds)

Objective assessment using measurable performance metrics